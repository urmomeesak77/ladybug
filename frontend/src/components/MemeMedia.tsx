import { useState } from 'react';

import type { FeedMedia } from '../lib/feedModel';

// Renders one post's media. `image` ⇒ responsive lazy <img>; `youtube` ⇒ sanitized
// <iframe> built only from the parsed embed URL (Principle VI); `none` ⇒ nothing (the
// FeedItem still shows the title). A runtime-broken image degrades to title-only rather
// than leaving a broken-image element (spec edge case).
function MemeMedia({ media }: { media: FeedMedia }) {
  const [isBroken, setIsBroken] = useState(false);

  if (media.kind === 'youtube') {
    return (
      <div className="meme-media meme-media--video">
        <iframe
          className="meme-media__iframe"
          src={media.embedUrl}
          title={media.title}
          loading="lazy"
          allow="accelerometer; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
        />
      </div>
    );
  }

  if (media.kind === 'image' && !isBroken) {
    return (
      <img
        className="meme-media meme-media__image"
        src={media.src}
        srcSet={media.srcset || undefined}
        sizes={media.srcset ? media.sizes : undefined}
        alt={media.alt}
        width={media.width}
        height={media.height}
        loading="lazy"
        onError={() => setIsBroken(true)}
      />
    );
  }

  return null;
}

export default MemeMedia;
