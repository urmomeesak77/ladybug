import type { FeedPost } from './feedModel';

// Entries auto-loaded on one page before the explicit "Load more" break (Principle III).
const PAGE_BREAK = 200;

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
  | { type: 'loadError' }
  | { type: 'removePost'; hash: string }
  | { type: 'removePosts'; hashes: string[] };

// Keyset pagination math plus the feed-load reducer, converged onto one class.
export class Pagination {
  static readonly initialState: FeedState = { status: 'idle', posts: [] };

  // Keyset cursor for the next batch: the last loaded post's hash (gap/duplicate-free per
  // the 004 API contract). Undefined for an empty list ⇒ request the newest page.
  static nextStart(items: { hash: string }[]): string | undefined {
    return items.length === 0 ? undefined : items[items.length - 1].hash;
  }

  // US2: turn the URL `?after` page cursor into the keyset `start` for the page's first
  // batch. They are the same value (request the batch *after* that hash); a missing or blank
  // cursor (incl. `useSearchParams().get('after')` returning null) means the newest page.
  static pageStart(after: string | null | undefined): string | undefined {
    const trimmed = after?.trim();
    return trimmed ? trimmed : undefined;
  }

  // Once this many entries are loaded on a page, stop auto-loading and show "Load more".
  static isPageBreak(count: number): boolean {
    return count >= PAGE_BREAK;
  }

  // A batch smaller than the requested limit (or empty) means the feed has no more data.
  static hasMore(batch: unknown[], limit: number): boolean {
    return batch.length >= limit;
  }

  static reducer(state: FeedState, action: FeedAction): FeedState {
    switch (action.type) {
      case 'loadStart':
        // In-flight guard: ignore a second load while one is pending (FR-015).
        if (Pagination.isInFlight(state.status)) {
          return state;
        }
        return { ...state, status: state.posts.length === 0 ? 'loading' : 'loadingMore' };
      case 'loadSuccess': {
        const posts = [...state.posts, ...action.posts];
        if (posts.length === 0) {
          return { status: 'empty', posts };
        }
        return { status: Pagination.hasMore(action.posts, action.limit) ? 'loaded' : 'end', posts };
      }
      case 'loadError':
        // Keep already-loaded posts so the user does not lose the feed on a failed append.
        return { ...state, status: 'error' };
      case 'removePost':
        // Drop a meme an admin just hid/removed in place; the persisted snapshot follows
        // the shortened list, so Back/refresh does not resurrect it.
        return { ...state, posts: state.posts.filter((post) => post.hash !== action.hash) };
      case 'removePosts': {
        // Drop, in one pass, the restored posts a background revalidation found deleted
        // server-side (see staleHashes); one dispatch avoids an intermediate render.
        const drop = new Set(action.hashes);
        return { ...state, posts: state.posts.filter((post) => !drop.has(post.hash)) };
      }
      default:
        return state;
    }
  }

  // The restored posts a background head revalidation proves were deleted server-side.
  //
  // A restored snapshot renders instantly (Back/refresh must keep scroll + loaded pages),
  // so we re-fetch only the newest batch and reconcile it against the loaded list. The
  // newest loaded post the server still returns is the boundary: anything ABOVE it the
  // server dropped was deleted; anything below is older than the re-fetched window and its
  // absence is unproven, so it is kept. When no loaded post appears in the head there is no
  // safe boundary (e.g. an all-new head), so nothing is dropped. New head-only posts are
  // never inserted — this reconciliation removes, it does not grow the list.
  static staleHashes(loaded: { hash: string }[], head: string[]): string[] {
    const present = new Set(head);
    let boundary = -1;
    for (let i = 0; i < loaded.length; i++) {
      if (present.has(loaded[i].hash)) {
        boundary = i;
      }
    }
    const stale: string[] = [];
    for (let i = 0; i < boundary; i++) {
      if (!present.has(loaded[i].hash)) {
        stale.push(loaded[i].hash);
      }
    }
    return stale;
  }

  private static isInFlight(status: FeedStatus): boolean {
    return status === 'loading' || status === 'loadingMore';
  }
}
