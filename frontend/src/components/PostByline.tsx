import { PostDate } from '../lib/postDate';

// The uploader byline shown below a meme's media: "by {author} · {date}". The author is
// the resolved account/snapshot name (or "Anonymous" when neither is present); the date
// clause is dropped entirely when the timestamp is missing or unparseable, so the line
// never reads "· Invalid Date". Author is rendered as text — React escapes it.
function PostByline({ author, createdAt }: { author: string | null; createdAt: string | null }) {
  const date = PostDate.format(createdAt);
  return (
    <p className="feed-item__byline">
      by {author ?? 'Anonymous'}
      {date ? ` · ${date}` : ''}
    </p>
  );
}

export default PostByline;
