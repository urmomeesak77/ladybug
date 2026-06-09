// Shown while a batch is in flight. role="status" announces the load to assistive tech.
function LoadingState() {
  return (
    <p className="feed-state" role="status">
      Loading memes…
    </p>
  );
}

export default LoadingState;
