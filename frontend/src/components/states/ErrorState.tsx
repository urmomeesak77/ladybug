// Shown when a batch request fails. Already-loaded items remain; Retry re-attempts the
// failed load (FR-013). role="alert" announces the failure to assistive tech.
function ErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="feed-state feed-state--error" role="alert">
      <p>Something went wrong loading memes.</p>
      <button type="button" onClick={onRetry}>
        Retry
      </button>
    </div>
  );
}

export default ErrorState;
