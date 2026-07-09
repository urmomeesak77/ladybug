import { Api } from './api';
import { ModerationModel } from './moderationModel';
import type { ModerationMeta, ModerationRow, RawModerationRow } from './moderationModel';

export type ModerationPageResult =
  | { ok: true; data: ModerationRow[]; meta: ModerationMeta }
  | { ok: false };

// Admin moderation API client (010). Cookie-session authenticated like the other SPA
// calls; the server enforces admin-or-higher, so a non-admin simply gets a failed result.
// Read-only for US1 — the four state-changing actions arrive in US3/US4.
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
}
