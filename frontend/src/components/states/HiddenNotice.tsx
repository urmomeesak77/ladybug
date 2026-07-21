// Banner shown on the single-post page when an admin or the owner is viewing a post that is
// not publicly visible. Text carries the meaning (color is never the sole signal — a11y);
// role="status" announces it politely alongside the page's live region.
const MESSAGES: Record<'pending' | 'deleted', string> = {
  pending: "This meme is pending review and isn't publicly visible yet.",
  deleted: "This meme has been deleted and isn't publicly visible.",
};

function HiddenNotice({ status }: { status: 'pending' | 'deleted' }) {
  return (
    <p className="hidden-notice" role="status">
      {MESSAGES[status]}
    </p>
  );
}

export default HiddenNotice;
