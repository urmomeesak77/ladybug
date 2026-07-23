import CommentForm from './CommentForm';
import CommentList from './CommentList';
import { useComments } from '../../hooks/useComments';

// The comment section rendered on a post page: the composer (auth/verify-gated), the public
// comment count, the newest-first list with its "load more" control, and an explicit empty
// state. Admin moderation controls layer on in US3/US4. Themed, responsive, and labelled as
// its own region for assistive tech (FR-016, FR-018).
function CommentSection({ hash }: { hash: string }) {
  const { comments, total, hasMore, loading, loadingMore, failed, loadMore, submit } = useComments(hash);

  return (
    <section className="comments" aria-label="Comments">
      <h2 className="comments__heading">Comments</h2>
      <CommentForm onSubmit={submit} />
      {loading ? <p className="comments__status">Loading comments…</p> : null}
      {!loading && failed ? (
        <p className="comments__status" role="alert">Comments could not be loaded.</p>
      ) : null}
      {!loading && !failed && total === 0 ? (
        <p className="comments__empty">No comments yet. Be the first to comment.</p>
      ) : null}
      {!loading && !failed && total > 0 ? (
        <>
          <p className="comments__count">{total === 1 ? '1 comment' : `${total} comments`}</p>
          <CommentList
            comments={comments}
            hasMore={hasMore}
            loadingMore={loadingMore}
            onLoadMore={loadMore}
          />
        </>
      ) : null}
    </section>
  );
}

export default CommentSection;
