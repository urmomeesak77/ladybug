import type { FeedPost } from './feedModel';

// Entries auto-loaded on one page before the explicit "Load more" break (Principle III).
const PAGE_BREAK = 200;

// Keyset cursor for the next batch: the last loaded post's hash (gap/duplicate-free per
// the 004 API contract). Undefined for an empty list ⇒ request the newest page.
export function nextStart(items: { hash: string }[]): string | undefined {
  return items.length === 0 ? undefined : items[items.length - 1].hash;
}

// Once this many entries are loaded on a page, stop auto-loading and show "Load more".
export function isPageBreak(count: number): boolean {
  return count >= PAGE_BREAK;
}

// A batch smaller than the requested limit (or empty) means the feed has no more data.
export function hasMore(batch: unknown[], limit: number): boolean {
  return batch.length >= limit;
}

export type FeedStatus =
  | 'idle'
  | 'loading'
  | 'loadingMore'
  | 'loaded'
  | 'empty'
  | 'end'
  | 'error';

export type FeedState = { status: FeedStatus; posts: FeedPost[] };

export type FeedAction =
  | { type: 'loadStart' }
  | { type: 'loadSuccess'; posts: FeedPost[]; limit: number }
  | { type: 'loadError' };

export const initialFeedState: FeedState = { status: 'idle', posts: [] };

function isInFlight(status: FeedStatus): boolean {
  return status === 'loading' || status === 'loadingMore';
}

export function feedReducer(state: FeedState, action: FeedAction): FeedState {
  switch (action.type) {
    case 'loadStart':
      // In-flight guard: ignore a second load while one is pending (FR-015).
      if (isInFlight(state.status)) {
        return state;
      }
      return { ...state, status: state.posts.length === 0 ? 'loading' : 'loadingMore' };
    case 'loadSuccess': {
      const posts = [...state.posts, ...action.posts];
      if (posts.length === 0) {
        return { status: 'empty', posts };
      }
      return { status: hasMore(action.posts, action.limit) ? 'loaded' : 'end', posts };
    }
    case 'loadError':
      // Keep already-loaded posts so the user does not lose the feed on a failed append.
      return { ...state, status: 'error' };
    default:
      return state;
  }
}
