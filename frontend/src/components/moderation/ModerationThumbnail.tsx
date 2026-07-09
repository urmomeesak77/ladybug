import { useState } from 'react';

// The row thumbnail, clipped to a small fixed box by CSS (.moderation-thumb). A null src
// (no stored variant / failed YouTube fetch) or an image that fails to load both fall back
// to a labelled placeholder rather than a broken image (FR-011). The placeholder keeps an
// accessible name so the column is never a silent blank for screen-reader users.
function ModerationThumbnail({ src, alt }: { src: string | null; alt: string }) {
  const [hasFailed, setHasFailed] = useState(false);

  if (src === null || hasFailed) {
    // An empty, CSS-styled box; the accessible name lives on aria-label so the column is
    // never a silent blank, and no visible text collides with the row's other cells.
    return <span className="moderation-thumb moderation-thumb--empty" role="img" aria-label="No thumbnail" />;
  }

  return (
    <img
      className="moderation-thumb"
      src={src}
      alt={alt}
      loading="lazy"
      onError={() => setHasFailed(true)}
    />
  );
}

export default ModerationThumbnail;
