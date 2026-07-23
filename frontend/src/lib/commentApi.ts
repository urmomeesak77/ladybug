import { Api } from './api';
import { CommentModel } from './commentModel';
import type { Comment, CommentPage, RawComment, RawCommentPage } from './commentModel';
import { Csrf } from './csrf';
import type { FieldErrors } from './authApi';

export type CommentPageResult =
  | { ok: true; page: CommentPage }
  | { ok: false };

// The create outcome. `validation` carries the server's field errors for the composer to show;
// auth/unverified/notFound/rateLimited map the status codes the create route can return; a
// rejected fetch or any other status is `network` (contracts, D8).
export type CommentCreateResult =
  | { ok: true; comment: Comment }
  | { ok: false; kind: 'validation'; errors: FieldErrors }
  | { ok: false; kind: 'auth' }
  | { ok: false; kind: 'unverified' }
  | { ok: false; kind: 'notFound' }
  | { ok: false; kind: 'rateLimited' }
  | { ok: false; kind: 'network' };

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

  // POST /api/posts/{hash}/comments — create a comment. Carries the Sanctum SPA CSRF header
  // like every unsafe call. The server enforces the verified gate and the rate limit; the
  // mapped status codes let the composer show the right message if the session/verify state
  // changed after the form rendered.
  static async create(hash: string, body: string): Promise<CommentCreateResult> {
    try {
      const token = await Csrf.ensure();
      const response = await fetch(`${Api.base()}/api/posts/${encodeURIComponent(hash)}/comments`, {
        method: 'POST',
        credentials: 'include',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-XSRF-TOKEN': token },
        body: JSON.stringify({ body }),
      });
      return await CommentApi.interpretCreate(response);
    } catch {
      return { ok: false, kind: 'network' };
    }
  }

  private static async interpretCreate(response: Response): Promise<CommentCreateResult> {
    if (response.status === 201) {
      const data = (await response.json()) as { data?: RawComment };
      return data.data ? { ok: true, comment: CommentModel.mapComment(data.data) } : { ok: false, kind: 'network' };
    }
    if (response.status === 401) {
      return { ok: false, kind: 'auth' };
    }
    if (response.status === 403) {
      return { ok: false, kind: 'unverified' };
    }
    if (response.status === 404) {
      return { ok: false, kind: 'notFound' };
    }
    if (response.status === 422) {
      const body = (await response.json()) as { errors?: FieldErrors };
      return { ok: false, kind: 'validation', errors: body.errors ?? {} };
    }
    if (response.status === 429) {
      return { ok: false, kind: 'rateLimited' };
    }
    return { ok: false, kind: 'network' };
  }
}
