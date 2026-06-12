import { useCallback, useEffect, useReducer, useRef } from 'react';

import { fetchPost } from '../lib/api';
import type { PostPageState } from '../lib/postModel';
import { initialPostPageState, postPageReducer } from '../lib/postModel';

// Thin React glue for the single-meme page: fetch on mount and on every hash change,
// expose an in-place retry. State transitions live in lib/postModel and IO in lib/api
// (both coverage-gated); this hook only sequences them.
export function usePost(hash: string | undefined): { state: PostPageState; retry: () => void } {
  const [state, dispatch] = useReducer(postPageReducer, initialPostPageState);
  // The hash whose response is still wanted. A slow response that resolves after the
  // user navigated to another meme must never paint over the new meme's state, so each
  // load re-checks this ref before dispatching its result (routes contract edge case).
  const wantedHashRef = useRef<string | undefined>(undefined);

  const load = useCallback(async (hashToLoad: string) => {
    wantedHashRef.current = hashToLoad;
    dispatch({ type: 'loadStart' });
    const result = await fetchPost(hashToLoad);
    if (wantedHashRef.current !== hashToLoad) {
      return;
    }
    if (result.ok) {
      dispatch({ type: 'loadSuccess', post: result.post });
    } else if (result.error.kind === 'notFound') {
      dispatch({ type: 'loadNotFound' });
    } else {
      dispatch({ type: 'loadError' });
    }
  }, []);

  // Load on mount and again whenever the route's hash changes (Back/Forward between
  // memes); a missing hash leaves the machine idle — the API is never called blind.
  useEffect(() => {
    if (hash !== undefined) {
      void load(hash);
    }
  }, [hash, load]);

  const retry = useCallback(() => {
    if (hash !== undefined) {
      void load(hash);
    }
  }, [hash, load]);

  return { state, retry };
}
