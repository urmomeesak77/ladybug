import { useCallback, useEffect, useReducer, useRef } from 'react';

import { Api } from '../lib/api';
import { FeedCache } from '../lib/feedCache';
import type { FeedState } from '../lib/pagination';
import { Pagination } from '../lib/pagination';

const BATCH_SIZE = 10;

// Build the reducer's initial state from a saved snapshot so Back/Forward and refresh
// re-render the posts the user already loaded instead of refetching the newest page.
function hydrate(cacheKey: string): FeedState {
  const snapshot = FeedCache.readSnapshot(sessionStorage, cacheKey);
  if (snapshot && snapshot.posts.length > 0) {
    return { status: snapshot.status, posts: snapshot.posts };
  }
  return Pagination.initialState;
}

// Feed state machine for one page: initial load, append-on-scroll, end/empty/error +
// retry. Math lives in lib/pagination, IO in lib/api; this hook is the React glue.
// `cacheKey` identifies the feed URL so its posts/cursor/anchor persist to sessionStorage.
export function useFeed(after: string | undefined, cacheKey: string) {
  const [state, dispatch] = useReducer(Pagination.reducer, cacheKey, hydrate);
  const isLoadingRef = useRef(false);
  // Seeded in the mount effect below — an inline useRef(readSnapshot(...)) argument
  // would re-parse sessionStorage on every render (initializer args are not lazy).
  const cursorRef = useRef<string | undefined>(undefined);

  const load = useCallback(async () => {
    if (isLoadingRef.current) {
      return;
    }
    isLoadingRef.current = true;
    dispatch({ type: 'loadStart' });

    const result = await Api.fetchFeed({ limit: BATCH_SIZE, start: cursorRef.current });
    if (result.ok) {
      cursorRef.current = Pagination.nextStart(result.posts) ?? cursorRef.current;
      dispatch({ type: 'loadSuccess', posts: result.posts, limit: BATCH_SIZE });
    } else {
      dispatch({ type: 'loadError' });
    }
    isLoadingRef.current = false;
  }, []);

  // Seed the cursor (snapshot cursor, else the URL cursor) and auto-load the first
  // batch only when nothing was hydrated from the snapshot.
  useEffect(() => {
    cursorRef.current = FeedCache.readSnapshot(sessionStorage, cacheKey)?.cursor ?? after;
    if (state.posts.length === 0) {
      void load();
    }
    // Run once on mount; `load` is stable and `state` is read only for the initial value.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist the loaded feed on every settled change, preserving the scroll anchor that
  // useScrollRestoration writes separately.
  useEffect(() => {
    if (state.status === 'idle' || state.status === 'loading' || state.status === 'error') {
      return;
    }
    const previous = FeedCache.readSnapshot(sessionStorage, cacheKey);
    FeedCache.writeSnapshot(sessionStorage, cacheKey, {
      posts: state.posts,
      cursor: cursorRef.current,
      status: state.status,
      anchorHash: previous?.anchorHash ?? null,
      anchorOffset: previous?.anchorOffset ?? 0,
    });
  }, [state.posts, state.status, cacheKey]);

  const atPageBreak = Pagination.isPageBreak(state.posts.length);
  // Auto-load only while the API has more and we have not hit the explicit page break.
  const canAutoLoad = state.status === 'loaded' && !atPageBreak;

  return { state, load, atPageBreak, canAutoLoad };
}
