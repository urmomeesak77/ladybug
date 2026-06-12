import { useParams } from 'react-router-dom';

import MemeMedia from '../components/MemeMedia';
import ErrorState from '../components/states/ErrorState';
import LoadingState from '../components/states/LoadingState';
import { usePost } from '../hooks/usePost';
import NotFoundPage from './NotFoundPage';

// The single-meme page at /posts/:hash — the permalink target for every feed entry.
// `hash` is opaque client-side (no format gate; the API is the authority — Principle V).
// The media is display-only: MemeMedia renders a plain <img> / sanitized iframe, no link.
// The wrapper is the page's one polite live region (mirroring Feed's pattern) so state
// transitions are announced; the branches are plain content, never nested live regions.
function PostPage() {
  const { hash } = useParams<{ hash: string }>();
  const { state, retry } = usePost(hash);

  return (
    <div className="post" aria-live="polite" aria-atomic="true">
      {(state.status === 'idle' || state.status === 'loading') && <LoadingState />}
      {state.status === 'notFound' && <NotFoundPage />}
      {state.status === 'error' && <ErrorState onRetry={retry} />}
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
