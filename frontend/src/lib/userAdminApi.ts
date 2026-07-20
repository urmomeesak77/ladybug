import type { PageMeta } from './adminPaging';
import { Api } from './api';
import { UserAdminModel } from './userAdminModel';
import type { RawUserRow, UserRow } from './userAdminModel';

export type UserAdminPageResult =
  | { ok: true; data: UserRow[]; meta: PageMeta }
  | { ok: false };

// Admin account console API client (012). Cookie-session authenticated like the other SPA
// calls; the server enforces admin-or-higher, so a non-admin simply gets a failed result.
// The disable/enable mutations (which carry the CSRF header) arrive in US3.
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
}
