import { useCallback, useEffect, useReducer, useRef } from 'react';

import { fetchFeed } from '../lib/api';
import { feedReducer, initialFeedState, isPageBreak, nextStart } from '../lib/pagination';

const BATCH_SIZE = 10;

// Feed state machine for one page: initial load, append-on-scroll, end/empty/error +
// retry. Math lives in lib/pagination, IO in lib/api; this hook is the React glue.
// A ref guards against concurrent fetches under rapid scroll (FR-015) — more reliable
// than reading reducer state inside the async callback.
export function useFeed(after?: string) {
  const [state, dispatch] = useReducer(feedReducer, initialFeedState);
  const isLoadingRef = useRef(false);
  const cursorRef = useRef<string | undefined>(after);

  const load = useCallback(async () => {
    if (isLoadingRef.current) {
      return;
    }
    isLoadingRef.current = true;
    dispatch({ type: 'loadStart' });

    const result = await fetchFeed({ limit: BATCH_SIZE, start: cursorRef.current });
    if (result.ok) {
      cursorRef.current = nextStart(result.posts) ?? cursorRef.current;
      dispatch({ type: 'loadSuccess', posts: result.posts, limit: BATCH_SIZE });
    } else {
      dispatch({ type: 'loadError' });
    }
    isLoadingRef.current = false;
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const atPageBreak = isPageBreak(state.posts.length);
  // Auto-load only while the API has more and we have not hit the explicit page break.
  const canAutoLoad = state.status === 'loaded' && !atPageBreak;

  return { state, load, atPageBreak, canAutoLoad };
}
