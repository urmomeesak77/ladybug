import { PostDate } from '../../lib/postDate';
import type { Comment } from '../../lib/commentModel';

// One comment row: author name, post time, and the body. The body is rendered as a plain-text
// React child ({comment.body}) — React escapes it, so markup in a comment shows as literal
// text and can never inject an element (never dangerouslySetInnerHTML — D10, FR-009).
// `white-space: pre-wrap` (comment__body CSS) keeps the author's line breaks. Admin controls
// (US3) layer on later behind a viewer-role gate.
function CommentItem({ comment }: { comment: Comment }) {
  const date = PostDate.format(comment.createdAt);
  return (
    <li className="comment">
      <div className="comment__header">
        <span className="comment__author">{comment.author ?? 'Anonymous'}</span>
        {date ? <span className="comment__date">{date}</span> : null}
      </div>
      <p className="comment__body">{comment.body}</p>
    </li>
  );
}

export default CommentItem;
