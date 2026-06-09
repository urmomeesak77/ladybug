import { Link } from 'react-router-dom';

import type { FeedPost } from '../lib/feedModel';
import MemeMedia from './MemeMedia';

// One feed entry: title + media. The title links to the meme's /posts/{hash} permalink
// (US2, FR-007). The title is the link text — meaningful for assistive tech — rather than
// wrapping the whole article, which would nest the media (incl. an iframe) inside an <a>.
function FeedItem({ post }: { post: FeedPost }) {
  const title = post.title ?? 'Untitled meme';
  return (
    <article className="feed-item">
      <h2 className="feed-item__title">
        <Link to={post.permalink}>{title}</Link>
      </h2>
      <MemeMedia media={post.media} />
    </article>
  );
}

export default FeedItem;
