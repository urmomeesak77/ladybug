import { Api } from './api';
import { Csrf } from './csrf';
import { ModerationModel } from './moderationModel';
import type { ModerationMeta, ModerationRow, RawModerationRow } from './moderationModel';

export type ModerationPageResult =
  | { ok: true; data: ModerationRow[]; meta: ModerationMeta }
  | { ok: false };

// A single state-change action (activate/deactivate; delete/restore land in US4). Success
// carries the server's updated row so the caller refreshes it in place (FR-017).
export type ModerationActionResult =
  | { ok: true; row: ModerationRow }
  | { ok: false };

// A purge has no row to return (204): success only says the post and its files are gone.
export type ModerationPurgeResult = { ok: boolean };

// Admin moderation API client (010). Cookie-session authenticated like the other SPA calls;
// the server enforces admin-or-higher, so a non-admin simply gets a failed result. Unsafe
// actions carry the Sanctum SPA CSRF header, exactly like the auth/upload mutations.
export class ModerationApi {
  static async fetchPage(page: number): Promise<ModerationPageResult> {
    try {
      const response = await fetch(`${Api.base()}/api/admin/posts?page=${page}`, {
        credentials: 'include',
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) {
        return { ok: false };
      }
      const body = (await response.json()) as { data?: RawModerationRow[]; meta: ModerationMeta };
      return { ok: true, data: (body.data ?? []).map(ModerationModel.mapRow), meta: body.meta };
    } catch {
      // fetch rejects only on network-level failures (offline, DNS); an unparseable body
      // lands here too. The page treats any failure as an empty result.
      return { ok: false };
    }
  }

  static activate(hash: string): Promise<ModerationActionResult> {
    return ModerationApi.act('POST', `/api/admin/posts/${encodeURIComponent(hash)}/activate`);
  }

  static deactivate(hash: string): Promise<ModerationActionResult> {
    return ModerationApi.act('POST', `/api/admin/posts/${encodeURIComponent(hash)}/deactivate`);
  }

  static remove(hash: string): Promise<ModerationActionResult> {
    return ModerationApi.act('DELETE', `/api/admin/posts/${encodeURIComponent(hash)}`);
  }

  static restore(hash: string): Promise<ModerationActionResult> {
    return ModerationApi.act('POST', `/api/admin/posts/${encodeURIComponent(hash)}/restore`);
  }

  // Hard delete: the row and its media files are removed for good. 204 carries no body,
  // so success is just `ok` — the caller drops the row from its page.
  static async purge(hash: string): Promise<ModerationPurgeResult> {
    try {
      const token = await Csrf.ensure();
      const response = await fetch(`${Api.base()}/api/admin/posts/${encodeURIComponent(hash)}/purge`, {
        method: 'DELETE',
        credentials: 'include',
        headers: { Accept: 'application/json', 'X-XSRF-TOKEN': token },
      });
      return { ok: response.ok };
    } catch {
      return { ok: false };
    }
  }

  // The shared act-on-a-meme plumbing: send the unsafe request with the CSRF header and, on
  // a 2xx, parse the single updated row. Any non-2xx or network failure is `ok: false`, so
  // the caller leaves the row as it was.
  private static async act(method: string, path: string): Promise<ModerationActionResult> {
    try {
      const token = await Csrf.ensure();
      const response = await fetch(`${Api.base()}${path}`, {
        method,
        credentials: 'include',
        headers: { Accept: 'application/json', 'X-XSRF-TOKEN': token },
      });
      if (!response.ok) {
        return { ok: false };
      }
      const body = (await response.json()) as { data: RawModerationRow };
      return { ok: true, row: ModerationModel.mapRow(body.data) };
    } catch {
      return { ok: false };
    }
  }
}
