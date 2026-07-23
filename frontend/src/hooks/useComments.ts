import { useCallback, useEffect, useState } from 'react';

import { CommentApi } from '../lib/commentApi';
import type { Comment, CommentPage } from '../lib/commentModel';
import { CommentModel } from '../lib/commentModel';

export type UseComments = {
  comments: Comment[];
  total: number;
  hasMore: boolean;
  loading: boolean;
  loadingMore: boolean;
  failed: boolean;
  loadMore: () => void;
};

// The last settled initial load: which post it was for, its page (null on failure), and
// whether it failed. `loading` is derived by comparing this to the post the caller currently
// asks for, so the effect never calls setState synchronously (useModeration's pattern —
// avoids cascading renders). loadMore/mutations run from event handlers, where setState is fine.
type Loaded = { hash: string; page: CommentPage | null; failed: boolean };

// React glue for a post's comment section: load the newest batch on mount, then append older
// batches on demand. List state and its reducer live in lib/commentModel and IO in
// lib/commentApi (both coverage-gated); this hook only sequences them. Later stories layer
// create/moderate mutations onto the same page state.
export function useComments(hash: string): UseComments {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  // Load the newest batch on mount and whenever the post changes. The `active` flag drops a
  // response that resolves after the section unmounted or switched posts so a slow reply
  // never paints over newer state.
  useEffect(() => {
    let active = true;
    void CommentApi.fetchPage(hash, undefined).then((result) => {
      if (!active) {
        return;
      }
      setLoaded({ hash, page: result.ok ? result.page : null, failed: !result.ok });
    });
    return () => {
      active = false;
    };
  }, [hash]);

  const loading = loaded === null || loaded.hash !== hash;
  const failed = !loading && loaded !== null && loaded.failed;
  const page = !loading && !failed && loaded !== null ? loaded.page : null;

  // Append the next older batch. A no-op when nothing older remains or a fetch is already in
  // flight, so a double click cannot fetch the same cursor twice.
  const loadMore = useCallback(() => {
    if (page === null || !page.hasMore || page.cursor === null || loadingMore) {
      return;
    }
    setLoadingMore(true);
    void CommentApi.fetchPage(hash, page.cursor).then((result) => {
      if (result.ok) {
        setLoaded((current) => (
          current === null || current.page === null
            ? current
            : { ...current, page: CommentModel.appendOlder(current.page, result.page) }
        ));
      }
      setLoadingMore(false);
    });
  }, [hash, page, loadingMore]);

  return {
    comments: page?.comments ?? [],
    total: page?.total ?? 0,
    hasMore: page?.hasMore ?? false,
    loading,
    loadingMore,
    failed,
    loadMore,
  };
}
