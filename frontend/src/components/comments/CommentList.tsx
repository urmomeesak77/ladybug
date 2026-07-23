import CommentItem from './CommentItem';
import type { Comment } from '../../lib/commentModel';

export type CommentListProps = {
  comments: Comment[];
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
};

// The ordered, newest-first list of comments plus the "load more older comments" control.
// The control appears only when an older batch remains (has_more) and is disabled while a
// batch is loading so a double click cannot fire two fetches (FR-019).
function CommentList({ comments, hasMore, loadingMore, onLoadMore }: CommentListProps) {
  return (
    <>
      <ol className="comment-list">
        {comments.map((comment) => (
          <CommentItem key={comment.hash} comment={comment} />
        ))}
      </ol>
      {hasMore ? (
        <button
          type="button"
          className="comment-list__more"
          onClick={onLoadMore}
          disabled={loadingMore}
        >
          {loadingMore ? 'Loading…' : 'Load more older comments'}
        </button>
      ) : null}
    </>
  );
}

export default CommentList;
