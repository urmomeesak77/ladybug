import { useParams } from 'react-router-dom';

import MemeMedia from '../components/MemeMedia';
import { usePost } from '../hooks/usePost';

// The single-meme page at /posts/:hash — the permalink target for every feed entry.
// `hash` is opaque client-side (no format gate; the API is the authority — Principle V).
// The media is display-only: MemeMedia renders a plain <img> / sanitized iframe, no link.
function PostPage() {
  const { hash } = useParams<{ hash: string }>();
  const { state } = usePost(hash);

  return (
    <div className="post">
      {state.status === 'loaded' && (
        <article className="post-item feed-item">
          <h1 className="feed-item__title">{state.post.title ?? 'Untitled meme'}</h1>
          <MemeMedia media={state.post.media} />
        </article>
      )}
    </div>
  );
}

export default PostPage;
