import { useState } from 'react';
import type { CSSProperties } from 'react';
import { Link } from 'react-router-dom';

import { useAnimatedImage } from '../hooks/useAnimatedImage';
import type { ImageFeedMedia } from './MemeMedia';

type CanvasStyle = CSSProperties & { '--meme-media-width'?: string };

// One post's image. Until the file proves itself animated this is byte-for-byte the <img>
// MemeMedia rendered before 021; once useAnimatedImage has decoded a multi-frame track the
// same element slot becomes a <canvas> it drives frame by frame (FR-001/FR-002). The swap is
// one-way and adds no control or overlay — the taken-over subtree is a single element
// (FR-013). Everything else about the post is preserved: the permalink wrapper, the text
// alternative (role="img" + aria-label carry the alt a canvas cannot hold on its own,
// FR-010) and the rendered box (FR-009).
function MemeImage({ media, linkTo }: { media: ImageFeedMedia; linkTo?: string }) {
  const [isBroken, setIsBroken] = useState(false);
  const { setNode, takeover, isPlaying } = useAnimatedImage(media.src);

  if (isBroken) {
    return null;
  }

  // The <img>'s width attribute is a presentational hint, so it lays out at exactly
  // media.width px (capped by max-width:100%). A canvas gets no such hint and would lay out
  // at its backing store — whichever variant was decoded — so the post's own width is handed
  // to CSS here and the swap changes the rendered box by nothing (FR-009, SC-003).
  const sizing = { '--meme-media-width': `${media.width}px` } as CanvasStyle;
  const element = takeover ? (
    <canvas
      ref={setNode}
      className="meme-media meme-media__image meme-media__canvas"
      role="img"
      aria-label={media.alt}
      // The decoded frame's own dimensions, not the stored ones: the browser may have picked
      // a smaller variant, and the canvas backing store must match what it decodes (FR-009).
      width={takeover.width}
      height={takeover.height}
      style={sizing}
      data-playing={isPlaying}
    />
  ) : (
    <img
      ref={setNode}
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
        {element}
      </Link>
    );
  }
  return element;
}

export default MemeImage;
