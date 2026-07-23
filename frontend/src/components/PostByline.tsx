import { PostDate } from '../lib/postDate';
import CommentCount from './CommentCount';

// The meta row below a meme's media: the uploader byline on the left ("by {author} · {date}")
// and the public comment count pinned to the right (design). The author is the resolved
// account/snapshot name (or "Anonymous"); the date clause is dropped when the timestamp is
// missing or unparseable, so the line never reads "· Invalid Date". Author is rendered as text.
function PostByline(
  { author, createdAt, commentCount }: { author: string | null; createdAt: string | null; commentCount: number },
) {
  const date = PostDate.format(createdAt);
  return (
    <div className="feed-item__meta">
      <p className="feed-item__byline">
        by {author ?? 'Anonymous'}
        {date ? ` · ${date}` : ''}
      </p>
      <CommentCount count={commentCount} />
    </div>
  );
}

export default PostByline;
