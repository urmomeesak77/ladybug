import { FeedModel } from './feedModel';
import type { FeedPost, RawPost } from './feedModel';

export type FeedError = { kind: 'http' | 'network'; status?: number };

export type FeedResult =
  | { ok: true; posts: FeedPost[] }
  | { ok: false; error: FeedError };

export type FeedParams = { limit?: number; start?: string };

export type PostError = { kind: 'notFound' | 'http' | 'network'; status?: number };

export type PostResult =
  | { ok: true; post: FeedPost }
  | { ok: false; error: PostError };

const DEFAULT_LIMIT = 10;
const MIN_LIMIT = 1;
const MAX_LIMIT = 50;

// Read-side JSON API client (004): the configured origin plus the feed and single-post
// fetches, converged onto one class.
export class Api {
  // Decoupled SPA: the API origin is environment-configured (Principle VI, research D9).
  // Empty base yields same-origin relative URLs, which is also what the unit tests assert.
  static base(): string {
    return import.meta.env.VITE_API_BASE_URL ?? '';
  }

  // Pure: build the feed request URL. Clamps/defaults limit and URL-encodes the keyset
  // cursor; `start` is omitted entirely when absent so the newest page is requested.
  static buildFeedUrl({ limit, start }: FeedParams): string {
    const query = new URLSearchParams({ limit: String(Api.clampLimit(limit)) });
    if (start) {
      query.set('start', start);
    }
    return `${Api.base()}/api/posts?${query.toString()}`;
  }

  static async fetchFeed(params: FeedParams): Promise<FeedResult> {
    try {
      const response = await fetch(Api.buildFeedUrl(params), {
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) {
        return { ok: false, error: { kind: 'http', status: response.status } };
      }
      const body = (await response.json()) as { data?: RawPost[] };
      const posts = (body.data ?? []).map(FeedModel.mapPost);
      return { ok: true, posts };
    } catch {
      // fetch rejects only on network-level failures (offline, DNS, CORS preflight).
      return { ok: false, error: { kind: 'network' } };
    }
  }

  // Pure: build the single-post request URL. The hash is opaque client-side, so it is
  // path-encoded verbatim — the API is the authority on its format (Principle V).
  static buildPostUrl(hash: string): string {
    return `${Api.base()}/api/posts/${encodeURIComponent(hash)}`;
  }

  // 404 is the only signal for missing/hidden/removed posts and maps to notFound; every
  // other failure (non-2xx, rejection, bad body) stays retryable (FR-006, FR-007).
  static async fetchPost(hash: string): Promise<PostResult> {
    try {
      const response = await fetch(Api.buildPostUrl(hash), {
        headers: { Accept: 'application/json' },
      });
      if (response.status === 404) {
        return { ok: false, error: { kind: 'notFound', status: 404 } };
      }
      if (!response.ok) {
        return { ok: false, error: { kind: 'http', status: response.status } };
      }
      const body = (await response.json()) as { data?: RawPost };
      if (!body.data) {
        // A 2xx without a post body is a malformed server response, not a missing post.
        return { ok: false, error: { kind: 'http', status: response.status } };
      }
      return { ok: true, post: FeedModel.mapPost(body.data) };
    } catch {
      // fetch rejects only on network-level failures (offline, DNS, CORS preflight);
      // an unparseable body lands here too and is equally retryable.
      return { ok: false, error: { kind: 'network' } };
    }
  }

  private static clampLimit(limit: number | undefined): number {
    if (limit === undefined) {
      return DEFAULT_LIMIT;
    }
    return Math.min(MAX_LIMIT, Math.max(MIN_LIMIT, Math.trunc(limit)));
  }
}
