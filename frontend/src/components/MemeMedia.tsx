import { useState } from 'react';
import { Link } from 'react-router-dom';

import type { FeedMedia } from '../lib/feedModel';

// Renders one post's media. `image` ⇒ responsive lazy <img>; `youtube` ⇒ sanitized
// <iframe> built only from the parsed embed URL (Principle VI); `none` ⇒ nothing (the
// FeedItem still shows the title). A runtime-broken image degrades to title-only rather
// than leaving a broken-image element (spec edge case).
// `linkTo` (feed only) wraps the image in a permalink; YouTube stays unwrapped because
// clicks land in the iframe, and on PostPage the prop is omitted (self-link is useless).
function MemeMedia({ media, linkTo }: { media: FeedMedia; linkTo?: string }) {
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
          // Belt-and-braces: the src is always a rebuilt nocookie embed URL, but the
          // sandbox caps what any embedded document could ever do (Principle VI).
          sandbox="allow-scripts allow-same-origin allow-presentation allow-popups"
        />
      </div>
    );
  }

  if (media.kind === 'video') {
    // Playback wiring only (poster + native controls) — autoplay-on-scroll and the custom
    // unmute control land in a later phase. muted+playsInline keep the element eligible for
    // a future autoplay without ever triggering a browser autoplay-blocked warning now, even
    // though nothing here auto-plays yet.
    return (
      <video
        className="meme-media meme-media__video"
        poster={media.src}
        muted
        playsInline
        controls
        width={media.width}
        height={media.height}
      >
        <source src={media.videoSrc} type={media.mime} />
      </video>
    );
  }

  if (media.kind === 'image' && !isBroken) {
    const image = (
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
    if (linkTo) {
      // tabIndex -1: pointer affordance only — the title link is the same destination,
      // so keyboard users keep one tab stop per entry; alt text stays exposed to AT.
      return (
        <Link className="meme-media__link" to={linkTo} tabIndex={-1}>
          {image}
        </Link>
      );
    }
    return image;
  }

  return null;
}

export default MemeMedia;
