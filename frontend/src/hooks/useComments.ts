import { useCallback, useEffect, useState } from 'react';

import { CommentApi } from '../lib/commentApi';
import type { CommentCreateResult } from '../lib/commentApi';
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
  submit: (body: string) => Promise<CommentCreateResult>;
  hide: (hash: string) => Promise<void>;
  unhide: (hash: string) => Promise<void>;
  remove: (hash: string) => Promise<void>;
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

  // Post a new comment. On success it prepends the created row in place and bumps the public
  // count (CommentModel.prependNew) without a reload (FR-006, SC-001); the result is returned
  // so the form can surface validation/other errors. A failure leaves the list untouched.
  const submit = useCallback(async (body: string): Promise<CommentCreateResult> => {
    const result = await CommentApi.create(hash, body);
    if (result.ok) {
      setLoaded((current) => (
        current === null || current.page === null
          ? current
          : { ...current, page: CommentModel.prependNew(current.page, result.comment) }
      ));
    }
    return result;
  }, [hash]);

  // Hide a comment: on success replace the row in place. CommentModel.replaceRow adjusts the
  // public count ONLY on a real visible↔hidden transition (comparing the prior local row to the
  // server response), so an idempotent/concurrent repeat never double-counts (FR-014, FR-015).
  const hide = useCallback(async (hash: string): Promise<void> => {
    const result = await CommentApi.hide(hash);
    if (result.ok) {
      setLoaded((current) => (
        current === null || current.page === null
          ? current
          : { ...current, page: CommentModel.replaceRow(current.page, result.comment) }
      ));
    }
  }, []);

  // Unhide a comment: symmetric with hide — replace in place, count adjusted only on a real
  // hidden→visible transition.
  const unhide = useCallback(async (hash: string): Promise<void> => {
    const result = await CommentApi.unhide(hash);
    if (result.ok) {
      setLoaded((current) => (
        current === null || current.page === null
          ? current
          : { ...current, page: CommentModel.replaceRow(current.page, result.comment) }
      ));
    }
  }, []);

  // Permanently delete a comment: on a 204 drop the row. CommentModel.dropRow decrements the
  // public count only when the removed row was visible — a hidden comment was never counted, so
  // removing it leaves the count unchanged (FR-014). Any non-2xx leaves the row (fail-safe).
  const remove = useCallback(async (hash: string): Promise<void> => {
    const result = await CommentApi.remove(hash);
    if (result.ok) {
      setLoaded((current) => (
        current === null || current.page === null
          ? current
          : { ...current, page: CommentModel.dropRow(current.page, hash) }
      ));
    }
  }, []);

  return {
    comments: page?.comments ?? [],
    total: page?.total ?? 0,
    hasMore: page?.hasMore ?? false,
    loading,
    loadingMore,
    failed,
    loadMore,
    submit,
    hide,
    unhide,
    remove,
  };
}
