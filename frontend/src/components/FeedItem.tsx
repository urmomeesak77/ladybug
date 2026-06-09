import type { FeedPost } from '../lib/feedModel';
import MemeMedia from './MemeMedia';

// One feed entry: title + media. The permalink wrapping (link to /posts/{hash}) is added
// in US2; for now the title is shown as a heading above the media.
function FeedItem({ post }: { post: FeedPost }) {
  return (
    <article className="feed-item">
      <h2 className="feed-item__title">{post.title ?? 'Untitled meme'}</h2>
      <MemeMedia media={post.media} />
    </article>
  );
}

export default FeedItem;
