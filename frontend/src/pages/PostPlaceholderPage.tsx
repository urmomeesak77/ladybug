import { useParams } from 'react-router-dom';

// Permalink target for /posts/:hash. The real single-meme page is a future feature; this
// placeholder confirms the route resolves and echoes the opaque public code. `hash` is
// treated as opaque (no client-side format gate; the API is the authority — research D10).
function PostPlaceholderPage() {
  const { hash } = useParams<{ hash: string }>();

  return (
    <section aria-labelledby="post-placeholder-heading">
      <h1 id="post-placeholder-heading">Single-meme page coming soon</h1>
      <p>
        The page for meme <code>{hash}</code> is not built yet.
      </p>
    </section>
  );
}

export default PostPlaceholderPage;
