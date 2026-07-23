import { Api } from './api';
import { CommentModel } from './commentModel';
import type { CommentPage, RawCommentPage } from './commentModel';

export type CommentPageResult =
  | { ok: true; page: CommentPage }
  | { ok: false };

// Comments API client (015). Reading is public but cookie-session aware — the session, when
// present, elevates what the server returns (an admin also receives hidden rows), so every
// call sends credentials like the single-post read. Create/moderation actions land in the
// later stories on this same class.
export class CommentApi {
  // GET /api/posts/{hash}/comments — one newest-first batch. `before` is the previous page's
  // cursor (a comment hash); omit it for the newest batch. The hash is opaque client-side, so
  // it is path-encoded verbatim (the API is the authority on its format, Principle V).
  static async fetchPage(hash: string, before?: string): Promise<CommentPageResult> {
    const query = before ? `?before=${encodeURIComponent(before)}` : '';
    try {
      const response = await fetch(`${Api.base()}/api/posts/${encodeURIComponent(hash)}/comments${query}`, {
        credentials: 'include',
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) {
        return { ok: false };
      }
      const body = (await response.json()) as RawCommentPage;
      return { ok: true, page: CommentModel.mapPage(body) };
    } catch {
      // fetch rejects only on network-level failures (offline, DNS); an unparseable body
      // lands here too. Either way the caller treats it as a failed load.
      return { ok: false };
    }
  }
}
