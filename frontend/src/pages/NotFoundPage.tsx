import { Link } from 'react-router-dom';

// Catch-all for unknown paths (the `*` route). Offers a labeled way back to the feed.
function NotFoundPage() {
  return (
    <section aria-labelledby="not-found-heading">
      <h1 id="not-found-heading">Page not found</h1>
      <p>The page you were looking for does not exist.</p>
      <Link to="/">Back to the feed</Link>
    </section>
  );
}

export default NotFoundPage;
