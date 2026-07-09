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
    return ModerationApi.act(`/api/admin/posts/${encodeURIComponent(hash)}/activate`);
  }

  static deactivate(hash: string): Promise<ModerationActionResult> {
    return ModerationApi.act(`/api/admin/posts/${encodeURIComponent(hash)}/deactivate`);
  }

  // The shared POST-an-action plumbing: send the unsafe request with the CSRF header and,
  // on a 2xx, parse the single updated row. Any non-2xx or network failure is `ok: false`,
  // so the caller leaves the row as it was.
  private static async act(path: string): Promise<ModerationActionResult> {
    try {
      const response = await fetch(`${Api.base()}${path}`, {
        method: 'POST',
        credentials: 'include',
        headers: { Accept: 'application/json', 'X-XSRF-TOKEN': Csrf.token() },
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
