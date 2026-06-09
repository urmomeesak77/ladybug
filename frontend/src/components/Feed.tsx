import { useEffect, useRef } from 'react';

import { useFeed } from '../hooks/useFeed';
import type { FeedStatus } from '../lib/pagination';
import FeedItem from './FeedItem';
import EmptyState from './states/EmptyState';
import EndOfFeedState from './states/EndOfFeedState';
import ErrorState from './states/ErrorState';
import LoadingState from './states/LoadingState';

// Live-region status so loading/end/error transitions are announced (Principle IV).
function FeedStatusRegion({ status, onRetry }: { status: FeedStatus; onRetry: () => void }) {
  return (
    <div className="feed__status" aria-live="polite">
      {(status === 'loading' || status === 'loadingMore') && <LoadingState />}
      {status === 'empty' && <EmptyState />}
      {status === 'end' && <EndOfFeedState />}
      {status === 'error' && <ErrorState onRetry={onRetry} />}
    </div>
  );
}

// The endless feed: renders loaded posts, auto-appends the next batch when a sentinel at
// the list end scrolls into view, and surfaces the "Load more" page break at 200 entries.
// Renders only the posts the API returned (FR-014); US2 turns "Load more" into a URL link.
function Feed({ after }: { after?: string }) {
  const { state, load, atPageBreak, canAutoLoad } = useFeed(after);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

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
          <li key={post.hash}>
            <FeedItem post={post} />
          </li>
        ))}
      </ul>
      <FeedStatusRegion status={state.status} onRetry={load} />
      {atPageBreak && state.status !== 'end' && (
        <button type="button" className="feed__load-more" onClick={() => void load()}>
          Load more
        </button>
      )}
      {canAutoLoad && <div ref={sentinelRef} className="feed__sentinel" aria-hidden="true" />}
    </div>
  );
}

export default Feed;
