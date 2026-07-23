// The at-a-glance public comment count shown at the right of a meme card's byline row. The
// number carries the meaning via the text aria-label; the speech-bubble icon is decorative
// (aria-hidden), so the badge is never icon-only (Principle IV). Display-only — no link.
function CommentCount({ count }: { count: number }) {
  const label = count === 1 ? '1 comment' : `${count} comments`;
  return (
    <span className="feed-item__comment-count" aria-label={label}>
      <svg
        className="feed-item__comment-icon"
        viewBox="0 0 24 24"
        aria-hidden="true"
        focusable="false"
      >
        <path d="M4 4h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H8l-4 4V6a2 2 0 0 1 2-2z" />
      </svg>
      <span aria-hidden="true">{count}</span>
    </span>
  );
}

export default CommentCount;
