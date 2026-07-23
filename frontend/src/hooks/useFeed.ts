import { useCallback, useEffect, useReducer, useRef } from 'react';
import type { MutableRefObject } from 'react';

import { Api } from '../lib/api';
import { FeedCache } from '../lib/feedCache';
import type { FeedState } from '../lib/pagination';
import { Pagination } from '../lib/pagination';

const BATCH_SIZE = 10;

type HydrateInit = { cacheKey: string; fresh: boolean };

// Build the reducer's initial state from a saved snapshot so Back/Forward and refresh
// re-render the posts the user already loaded instead of refetching. A fresh (link)
// navigation skips the snapshot here, in the initializer: on a keyed remount this runs
// before the outgoing feed's unmount cleanup, so storage cannot be trusted to be
// cleared yet.
function hydrate(init: HydrateInit): FeedState {
  if (init.fresh) {
    return Pagination.initialState;
  }
  const snapshot = FeedCache.readSnapshot(sessionStorage, init.cacheKey);
  if (snapshot && snapshot.posts.length > 0) {
    return { status: snapshot.status, posts: snapshot.posts };
  }
  return Pagination.initialState;
}

// Persist the loaded feed on every settled change, preserving the scroll anchor that
// useScrollRestoration writes separately. Its own hook keeps useFeed inside the
// 50-line budget (Principle II).
function usePersistSnapshot(state: FeedState, cacheKey: string, cursor: () => string | undefined): void {
  useEffect(() => {
    if (state.status === 'idle' || state.status === 'loading' || state.status === 'error') {
      return;
    }
    const previous = FeedCache.readSnapshot(sessionStorage, cacheKey);
    FeedCache.writeSnapshot(sessionStorage, cacheKey, {
      posts: state.posts,
      cursor: cursor(),
      status: state.status,
      anchorHash: previous?.anchorHash ?? null,
      anchorOffset: previous?.anchorOffset ?? 0,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.posts, state.status, cacheKey]);
}

// Revalidate a restored snapshot in the background: a Back/Forward/refresh (POP) renders
// the saved posts instantly to keep scroll + loaded pages, but those posts can be stale —
// a meme purged/hidden server-side since is still in the snapshot. Once, on such a mount,
// re-fetch the newest batch and drop any restored post the live head proves is gone
// (Pagination.staleHashes). Skipped on a fresh mount (it already reloaded page 1) and when
// nothing was hydrated (useInitialLoad fetches page 1 there). Runs once — its own hook so
// useFeed stays within the 50-line budget (Principle II).
function useRevalidateOnRestore(
  active: boolean,
  postsRef: MutableRefObject<{ hash: string }[]>,
  removePosts: (hashes: string[]) => void,
): void {
  useEffect(() => {
    if (!active || postsRef.current.length === 0) {
      return;
    }
    let cancelled = false;
    void (async () => {
      const result = await Api.fetchFeed({ limit: BATCH_SIZE });
      if (cancelled || !result.ok) {
        return;
      }
      const stale = Pagination.staleHashes(postsRef.current, result.posts.map((p) => p.hash));
      if (stale.length > 0) {
        removePosts(stale);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

// Seed the cursor (snapshot cursor, else the URL cursor) and auto-load the first batch
// only when nothing was hydrated from the snapshot. A fresh mount drops the stored
// snapshot first so the stale anchor/cursor cannot resurface (updateSnapshot no-ops
// while no snapshot exists). Runs once on mount by design — hence the fixed empty
// dependency list — so it lives in its own hook rather than inflating useFeed
// (Principle II).
function useInitialLoad(
  init: { fresh: boolean; cacheKey: string; after: string | undefined; hasPosts: boolean },
  cursorRef: MutableRefObject<string | undefined>,
  load: () => Promise<void>,
): void {
  useEffect(() => {
    if (init.fresh) {
      FeedCache.clearSnapshot(sessionStorage, init.cacheKey);
    }
    cursorRef.current = FeedCache.readSnapshot(sessionStorage, init.cacheKey)?.cursor ?? init.after;
    if (!init.hasPosts) {
      void load();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

// Feed state machine for one page: initial load, append-on-scroll, end/empty/error +
// retry. Math lives in lib/pagination, IO in lib/api; this hook is the React glue.
// `cacheKey` identifies the feed URL so its posts/cursor/anchor persist to sessionStorage;
// `fresh` (link navigation) discards that persisted state and reloads page 1.
export function useFeed(after: string | undefined, cacheKey: string, fresh: boolean) {
  const [state, dispatch] = useReducer(Pagination.reducer, { cacheKey, fresh }, hydrate);
  const isLoadingRef = useRef(false);
  // Seeded by useInitialLoad below — an inline useRef(readSnapshot(...)) argument
  // would re-parse sessionStorage on every render (initializer args are not lazy).
  const cursorRef = useRef<string | undefined>(undefined);
  // Tracks the current posts so the background revalidation reads the up-to-date list
  // (the hydrated snapshot at mount, plus any in-feed removal that lands first), not a
  // value captured when its effect was created. Initialized with the hydrated posts so it
  // is already correct at mount; kept in sync from an effect (never written during render).
  const postsRef = useRef(state.posts);
  useEffect(() => {
    postsRef.current = state.posts;
  }, [state.posts]);

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

  useInitialLoad({ fresh, cacheKey, after, hasPosts: state.posts.length > 0 }, cursorRef, load);

  // A named function (not an inline closure) so the cursor's current value is read
  // lazily inside usePersistSnapshot's effect, rather than captured at call time.
  function readCursor(): string | undefined {
    return cursorRef.current;
  }

  usePersistSnapshot(state, cacheKey, readCursor);

  // Drop, in one settled render, the restored posts a background revalidation found deleted
  // server-side. The stale hashes are always above the keyset cursor (the last loaded post,
  // which the head still returns is the boundary), so the cursor never needs reseating here.
  const removePosts = useCallback((hashes: string[]) => {
    dispatch({ type: 'removePosts', hashes });
  }, []);

  useRevalidateOnRestore(!fresh, postsRef, removePosts);

  // Drop a meme an admin hid/removed in place (in-feed moderation). When the dropped post is
  // the keyset cursor (the last loaded one), reseat the cursor onto the prior post first: the
  // next batch keys off the last loaded hash, and a removed cursor no longer resolves on the
  // server — which would either dead-end the feed (a deactivated row's activated_at is null)
  // or reset to the newest page and duplicate posts. The persist effect then writes the
  // shortened list and corrected cursor to the snapshot on the next settled render.
  const removePost = useCallback((hash: string) => {
    if (cursorRef.current === hash) {
      cursorRef.current = Pagination.nextStart(state.posts.filter((post) => post.hash !== hash));
    }
    dispatch({ type: 'removePost', hash });
  }, [state.posts]);

  const atPageBreak = Pagination.isPageBreak(state.posts.length);
  // Auto-load only while the API has more and we have not hit the explicit page break.
  const canAutoLoad = state.status === 'loaded' && !atPageBreak;

  return { state, load, atPageBreak, canAutoLoad, removePost };
}
