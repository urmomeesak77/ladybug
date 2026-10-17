import { useCallback, useEffect, useReducer, useRef } from 'react';
import type { Dispatch, RefObject } from 'react';

import { Api } from '../lib/api';
import type { PostPageAction, PostPageState } from '../lib/postModel';
import { PostModel } from '../lib/postModel';
import { ProcessingPoll } from '../lib/processingPoll';

// Thin React glue for the single-meme page: fetch on mount and on every hash change,
// expose an in-place retry. State transitions live in lib/postModel and IO in lib/api
// (both coverage-gated); this hook only sequences them.
export function usePost(hash: string | undefined): {
  state: PostPageState;
  retry: () => void;
  applyModeration: (hidden: 'pending' | 'deleted' | null) => void;
} {
  const [state, dispatch] = useReducer(PostModel.reducer, PostModel.initialState);
  // The hash whose response is still wanted. A slow response that resolves after the
  // user navigated to another meme must never paint over the new meme's state, so each
  // load re-checks this ref before dispatching its result (routes contract edge case).
  const wantedHashRef = useRef<string | undefined>(undefined);

  const load = useCallback(async (hashToLoad: string) => {
    wantedHashRef.current = hashToLoad;
    dispatch({ type: 'loadStart' });
    const result = await Api.fetchPost(hashToLoad);
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

  // Refresh the visible state after an in-place admin action (no refetch); the reducer
  // ignores it unless a post is loaded.
  const applyModeration = useCallback((hidden: 'pending' | 'deleted' | null) => {
    dispatch({ type: 'applyModeration', hidden });
  }, []);

  const isProcessing = state.status === 'loaded' && state.post.mediaState === 'processing';
  useProcessingRefresh(isProcessing ? hash : undefined, wantedHashRef, dispatch);

  return { state, retry, applyModeration };
}

// While the shown post's upload is still processing (024), re-fetch it every few seconds and
// swap the result in place: a loadSuccess straight onto the loaded post, never a loadStart,
// so the page does not flash its loading state. A transient failure keeps the processing view
// and simply tries again on the next tick; a 404 (purged meanwhile) shows not-found. Passing
// no hash — the post finished, failed, or the page left — stops the poll.
function useProcessingRefresh(
  hash: string | undefined,
  wantedHashRef: RefObject<string | undefined>,
  dispatch: Dispatch<PostPageAction>,
): void {
  useEffect(() => {
    if (hash === undefined) {
      return undefined;
    }
    const poll = new ProcessingPoll(async () => {
      const result = await Api.fetchPost(hash);
      if (wantedHashRef.current !== hash) {
        return;
      }
      if (result.ok) {
        dispatch({ type: 'loadSuccess', post: result.post });
      } else if (result.error.kind === 'notFound') {
        dispatch({ type: 'loadNotFound' });
      }
    });
    poll.start();
    return () => poll.stop();
  }, [hash, wantedHashRef, dispatch]);
}
