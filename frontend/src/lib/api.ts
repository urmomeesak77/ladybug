import { mapPost } from './feedModel';
import type { FeedPost, RawPost } from './feedModel';

export type FeedError = { kind: 'http' | 'network'; status?: number };

export type FeedResult =
  | { ok: true; posts: FeedPost[] }
  | { ok: false; error: FeedError };

export type FeedParams = { limit?: number; start?: string };

const DEFAULT_LIMIT = 10;
const MIN_LIMIT = 1;
const MAX_LIMIT = 50;

// Decoupled SPA: the API origin is environment-configured (Principle VI, research D9).
// Empty base yields same-origin relative URLs, which is also what the unit tests assert.
function apiBase(): string {
  return import.meta.env.VITE_API_BASE_URL ?? '';
}

function clampLimit(limit: number | undefined): number {
  if (limit === undefined) {
    return DEFAULT_LIMIT;
  }
  return Math.min(MAX_LIMIT, Math.max(MIN_LIMIT, Math.trunc(limit)));
}

// Pure: build the feed request URL. Clamps/defaults limit and URL-encodes the keyset
// cursor; `start` is omitted entirely when absent so the newest page is requested.
export function buildFeedUrl({ limit, start }: FeedParams): string {
  const query = new URLSearchParams({ limit: String(clampLimit(limit)) });
  if (start) {
    query.set('start', start);
  }
  return `${apiBase()}/api/posts?${query.toString()}`;
}

export async function fetchFeed(params: FeedParams): Promise<FeedResult> {
  try {
    const response = await fetch(buildFeedUrl(params), {
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) {
      return { ok: false, error: { kind: 'http', status: response.status } };
    }
    const body = (await response.json()) as { data?: RawPost[] };
    const posts = (body.data ?? []).map(mapPost);
    return { ok: true, posts };
  } catch {
    // fetch rejects only on network-level failures (offline, DNS, CORS preflight).
    return { ok: false, error: { kind: 'network' } };
  }
}
