import { Link } from 'react-router-dom';

import type { FeedPost } from '../lib/feedModel';
import MemeMedia from './MemeMedia';
import PostByline from './PostByline';

// One feed entry: title + media. The title links to the meme's /posts/{hash} permalink
// (US2, FR-007) and stays the link for assistive tech; an image also links there via
// MemeMedia's linkTo (pointer-only duplicate) rather than wrapping the whole article,
// which would nest the media (incl. an iframe) inside an <a>.
function FeedItem({ post }: { post: FeedPost }) {
  const title = post.title ?? 'Untitled meme';
  return (
    <article className="feed-item">
      <h2 className="feed-item__title">
        <Link to={post.permalink}>{title}</Link>
      </h2>
      <MemeMedia media={post.media} linkTo={post.permalink} />
      <PostByline author={post.author} createdAt={post.createdAt} />
    </article>
  );
}

export default FeedItem;
