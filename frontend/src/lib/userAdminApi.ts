import type { PageMeta } from './adminPaging';
import { Api } from './api';
import { Csrf } from './csrf';
import { UserAdminModel } from './userAdminModel';
import type { RawUserRow, UserRow } from './userAdminModel';

export type UserAdminPageResult =
  | { ok: true; data: UserRow[]; meta: PageMeta }
  | { ok: false };

// A single disable/enable action. Success carries the server's updated row so the caller
// refreshes it in place (FR-016); any failure leaves the row exactly as it was.
export type UserAdminActionResult =
  | { ok: true; row: UserRow }
  | { ok: false };

// A permanent delete has no row to return (204): success only says the account is gone (D8).
export type UserAdminDeleteResult = { ok: boolean };

// Admin account console API client (012). Cookie-session authenticated like the other SPA
// calls; the server enforces admin-or-higher, so a non-admin simply gets a failed result. The
// disable/enable mutations carry the Sanctum SPA CSRF header, exactly like the auth/upload calls.
export class UserAdminApi {
  static async fetchPage(page: number): Promise<UserAdminPageResult> {
    try {
      const response = await fetch(`${Api.base()}/api/admin/users?page=${page}`, {
        credentials: 'include',
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) {
        return { ok: false };
      }
      const body = (await response.json()) as { data?: RawUserRow[]; meta: PageMeta };
      return { ok: true, data: (body.data ?? []).map(UserAdminModel.toRow), meta: body.meta };
    } catch {
      // fetch rejects only on network-level failures (offline, DNS); an unparseable body
      // lands here too. The page treats any failure as a distinct error state, not "empty".
      return { ok: false };
    }
  }

  static disable(hash: string): Promise<UserAdminActionResult> {
    return UserAdminApi.act(`/api/admin/users/${encodeURIComponent(hash)}/disable`);
  }

  static enable(hash: string): Promise<UserAdminActionResult> {
    return UserAdminApi.act(`/api/admin/users/${encodeURIComponent(hash)}/enable`);
  }

  // Permanent account deletion (013). 204 carries no body, so success is just `ok` — the
  // caller drops the row from its page. Mirrors the meme-purge client; any non-2xx (incl. a
  // 404 from a concurrent delete) or network failure is `ok: false`, so the row is left as it was.
  static async destroy(hash: string): Promise<UserAdminDeleteResult> {
    try {
      const token = await Csrf.ensure();
      const response = await fetch(`${Api.base()}/api/admin/users/${encodeURIComponent(hash)}`, {
        method: 'DELETE',
        credentials: 'include',
        headers: { Accept: 'application/json', 'X-XSRF-TOKEN': token },
      });
      return { ok: response.ok };
    } catch {
      return { ok: false };
    }
  }

  // The shared act-on-an-account plumbing: POST the unsafe request with the CSRF header and,
  // on a 2xx, parse the single updated row. Any non-2xx or network failure is `ok: false`, so
  // the caller leaves the row untouched.
  private static async act(path: string): Promise<UserAdminActionResult> {
    try {
      const token = await Csrf.ensure();
      const response = await fetch(`${Api.base()}${path}`, {
        method: 'POST',
        credentials: 'include',
        headers: { Accept: 'application/json', 'X-XSRF-TOKEN': token },
      });
      if (!response.ok) {
        return { ok: false };
      }
      const body = (await response.json()) as { data: RawUserRow };
      return { ok: true, row: UserAdminModel.toRow(body.data) };
    } catch {
      return { ok: false };
    }
  }
}
