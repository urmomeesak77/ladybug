import CommentForm from './CommentForm';
import CommentList from './CommentList';
import { useAuth } from '../../hooks/useAuth';
import { useComments } from '../../hooks/useComments';

// The comment section rendered on a post page: the composer (auth/verify-gated), the public
// comment count, the newest-first list with its "load more" control, and an explicit empty
// state. Admin+ viewers additionally get per-row moderation controls (hide/unhide; delete in
// US4). Themed, responsive, and labelled as its own region for assistive tech (FR-016, FR-018).
function CommentSection({ hash }: { hash: string }) {
  const { role } = useAuth();
  const { comments, total, hasMore, loading, loadingMore, failed, loadMore, submit, hide, unhide, remove } = useComments(hash);

  return (
    <section className="comments" aria-label="Comments">
      <h2 className="comments__heading">Comments</h2>
      <CommentForm onSubmit={submit} />
      {loading ? <p className="comments__status">Loading comments…</p> : null}
      {!loading && failed ? (
        <p className="comments__status" role="alert">Comments could not be loaded.</p>
      ) : null}
      {/* Gate on the rows the viewer actually has, not the public `total`: an admin sees hidden
          rows the public count excludes, so once every remaining comment is hidden `total` is 0
          while the admin still holds rows to moderate — gating on `total` would hide them and
          their Unhide control (D6/D7). The count line stays on the public total. */}
      {!loading && !failed && comments.length === 0 ? (
        <p className="comments__empty">No comments yet. Be the first to comment.</p>
      ) : null}
      {!loading && !failed && comments.length > 0 ? (
        <>
          {total > 0 ? (
            <p className="comments__count">{total === 1 ? '1 comment' : `${total} comments`}</p>
          ) : null}
          <CommentList
            comments={comments}
            hasMore={hasMore}
            loadingMore={loadingMore}
            onLoadMore={loadMore}
            viewerRole={role}
            onHide={hide}
            onUnhide={unhide}
            onDelete={remove}
          />
        </>
      ) : null}
    </section>
  );
}

export default CommentSection;
