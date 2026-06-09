// Shown while a batch is in flight. Announced via Feed's enclosing live region (no own
// role, to avoid nesting live regions).
function LoadingState() {
  return <p className="feed-state">Loading memes…</p>;
}

export default LoadingState;
