import { useEffect, useRef } from 'react';
import { Link, useLocation } from 'react-router-dom';

import { useFeed } from '../hooks/useFeed';
import { useScrollRestoration } from '../hooks/useScrollRestoration';
import { FeedCache } from '../lib/feedCache';
import { Pagination } from '../lib/pagination';
import type { FeedStatus } from '../lib/pagination';
import FeedItem from './FeedItem';
import EmptyState from './states/EmptyState';
import EndOfFeedState from './states/EndOfFeedState';
import ErrorState from './states/ErrorState';
import LoadingState from './states/LoadingState';

// Single persistent live region so loading/end/error transitions are announced as the
// message inside it changes (Principle IV). It is the only live region — the state views
// below are plain content, not nested live regions, to avoid double announcements.
function FeedStatusRegion({ status, onRetry }: { status: FeedStatus; onRetry: () => void }) {
  return (
    <div className="feed__status" aria-live="polite" aria-atomic="true">
      {(status === 'loading' || status === 'loadingMore') && <LoadingState />}
      {status === 'empty' && <EmptyState />}
      {status === 'end' && <EndOfFeedState />}
      {status === 'error' && <ErrorState onRetry={onRetry} />}
    </div>
  );
}

// The endless feed: renders loaded posts, auto-appends the next batch when a sentinel at
// the list end scrolls into view, and surfaces the "Load more" page break at 200 entries.
// Renders only the posts the API returned (FR-014); "Load more" advances the URL (US2).
function Feed({ after }: { after?: string }) {
  const location = useLocation();
  const cacheKey = FeedCache.feedKey(location.pathname, location.search);
  const { state, load, atPageBreak, canAutoLoad } = useFeed(after, cacheKey);
  useScrollRestoration(cacheKey, false);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  // The next page's `?after` cursor is the last loaded post's hash (FR-004/FR-005).
  const nextCursor = Pagination.nextStart(state.posts);

  useEffect(() => {
    if (!canAutoLoad || !sentinelRef.current) {
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting) {
        void load();
      }
    });
    observer.observe(sentinelRef.current);
    return () => observer.disconnect();
  }, [canAutoLoad, load]);

  return (
    <div className="feed">
      <ul className="feed__list">
        {state.posts.map((post) => (
          <li key={post.hash} data-hash={post.hash}>
            <FeedItem post={post} />
          </li>
        ))}
      </ul>
      <FeedStatusRegion status={state.status} onRetry={load} />
      {atPageBreak && state.status !== 'end' && nextCursor && (
        <Link className="feed__load-more" to={`/?after=${encodeURIComponent(nextCursor)}`}>
          Load more
        </Link>
      )}
      {canAutoLoad && <div ref={sentinelRef} className="feed__sentinel" aria-hidden="true" />}
    </div>
  );
}

export default Feed;
