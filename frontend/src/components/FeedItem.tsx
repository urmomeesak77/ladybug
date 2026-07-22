import { Link } from 'react-router-dom';

import type { FeedPost } from '../lib/feedModel';
import AdminPostActions from './moderation/AdminPostActions';
import MemeMedia from './MemeMedia';
import PostByline from './PostByline';

type FeedItemProps = {
  post: FeedPost;
  // Admin-only in-place moderation (default off): the parent decides eligibility.
  canModerate?: boolean;
  onRemove?: (hash: string) => void;
};

// One feed entry: title + media. The title links to the meme's /posts/{hash} permalink
// (US2, FR-007) and stays the link for assistive tech; an image also links there via
// MemeMedia's linkTo. Admins additionally get the moderation kebab in the header's
// top-right; any action that hides or removes the meme drops it from the feed, since a
// deactivated/deleted meme is no longer public and a live-looking card would mislead.
function FeedItem({ post, canModerate = false, onRemove }: FeedItemProps) {
  const title = post.title ?? 'Untitled meme';
  function drop(): void {
    onRemove?.(post.hash);
  }
  // An action that leaves the meme public (hidden null) keeps its card; anything that hides
  // it (pending/deleted) drops it, since a live-looking card would then mislead.
  function onApplied(hidden: 'pending' | 'deleted' | null): void {
    if (hidden !== null) {
      drop();
    }
  }
  return (
    <article className="feed-item">
      <div className="feed-item__header">
        <h2 className="feed-item__title">
          <Link to={post.permalink}>{title}</Link>
        </h2>
        {canModerate && (
          <AdminPostActions
            hash={post.hash}
            title={post.title}
            hidden={post.hidden}
            onApplied={onApplied}
            onRemoved={drop}
          />
        )}
      </div>
      <MemeMedia media={post.media} linkTo={post.permalink} />
      <PostByline author={post.author} createdAt={post.createdAt} />
    </article>
  );
}

export default FeedItem;
