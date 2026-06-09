// Shown when a batch request fails. Already-loaded items remain; Retry re-attempts the
// failed load (FR-013). The failure text is announced via Feed's enclosing live region (no
// own role, to avoid nesting live regions).
function ErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="feed-state feed-state--error">
      <p>Something went wrong loading memes.</p>
      <button type="button" onClick={onRetry}>
        Retry
      </button>
    </div>
  );
}

export default ErrorState;
