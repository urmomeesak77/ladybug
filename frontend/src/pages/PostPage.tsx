import { useEffect, useLayoutEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import AdminPostActions from '../components/moderation/AdminPostActions';
import CommentSection from '../components/comments/CommentSection';
import MemeMedia from '../components/MemeMedia';
import PostByline from '../components/PostByline';
import ErrorState from '../components/states/ErrorState';
import HiddenNotice from '../components/states/HiddenNotice';
import LoadingState from '../components/states/LoadingState';
import { useAuth } from '../hooks/useAuth';
import { usePost } from '../hooks/usePost';
import { PostModel } from '../lib/postModel';
import { Role } from '../lib/role';
import NotFoundPage from './NotFoundPage';

// The single-meme page at /posts/:hash — the permalink target for every feed entry.
// `hash` is opaque client-side (no format gate; the API is the authority — Principle V).
// The media is display-only: MemeMedia renders a plain <img> / sanitized iframe, no link.
// The wrapper is the page's one polite live region (mirroring Feed's pattern) so state
// transitions are announced; the branches are plain content, never nested live regions.
function PostPage() {
  const { hash } = useParams<{ hash: string }>();
  const navigate = useNavigate();
  const { role } = useAuth();
  const { state, retry, applyModeration } = usePost(hash);
  // Admin+ viewers get the in-place moderation kebab; the server still gates the actions.
  const canModerate = Role.rank(role) >= Role.rank('admin');

  // 005 set history.scrollRestoration = 'manual' globally (the feed restores its own
  // anchor), so the browser no longer resets scroll on SPA navigation — without this
  // the post page would inherit the feed's scroll offset. Before paint, on every
  // post-page open including Forward and meme→meme (FR-008, research D6).
  useLayoutEffect(() => {
    window.scrollTo(0, 0);
  }, [hash]);

  // Tab title identifies the meme once loaded; every other state shows the plain site
  // name so a meme→meme navigation never keeps the previous meme's title (FR-009).
  useEffect(() => {
    document.title = state.status === 'loaded'
      ? PostModel.formatDocumentTitle(state.post.title)
      : PostModel.formatDocumentTitle(null);
  }, [state]);

  return (
    <div className="post" aria-live="polite" aria-atomic="true">
      {(state.status === 'idle' || state.status === 'loading') && <LoadingState />}
      {state.status === 'notFound' && <NotFoundPage />}
      {state.status === 'error' && <ErrorState onRetry={retry} />}
      {state.status === 'loaded' && (
        <article className="post-item feed-item">
          {state.post.hidden && <HiddenNotice status={state.post.hidden} />}
          <div className="feed-item__header">
            <h1 className="feed-item__title">{state.post.title ?? 'Untitled meme'}</h1>
            {canModerate && (
              <AdminPostActions
                hash={state.post.hash}
                title={state.post.title}
                hidden={state.post.hidden}
                onApplied={applyModeration}
                onRemoved={() => navigate('/')}
              />
            )}
          </div>
          <MemeMedia media={state.post.media} />
          <PostByline author={state.post.author} createdAt={state.post.createdAt} />
          <CommentSection hash={state.post.hash} />
        </article>
      )}
    </div>
  );
}

export default PostPage;
