import { useRef, useState } from 'react';
import type { Dispatch, RefObject, SetStateAction } from 'react';
import { Link } from 'react-router-dom';

import { useVideoAutoplay } from '../hooks/useVideoAutoplay';
import type { FeedMedia } from '../lib/feedModel';

type VideoFeedMedia = Extract<FeedMedia, { kind: 'video' }>;
type YoutubeFeedMedia = Extract<FeedMedia, { kind: 'youtube' }>;

// Flat 24x24 currentColor path glyphs, same style as moderation/ActionGlyph.tsx's play/pause
// shapes (play/pause paths are identical); mute/unmute are the standard Material Design
// volume_off/volume_up glyphs. Decorative only — the button's aria-label carries the
// accessible name (Principle IV).
const VIDEO_CONTROL_GLYPHS: Record<'play' | 'pause' | 'mute' | 'unmute', string> = {
  play: 'M8 5v14l11-7z',
  pause: 'M6 19h4V5H6v14zm8-14v14h4V5h-4z',
  unmute:
    'M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z',
  mute:
    'M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z',
};

function VideoGlyph({ name }: { name: keyof typeof VIDEO_CONTROL_GLYPHS }) {
  return (
    <svg className="meme-media__video-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d={VIDEO_CONTROL_GLYPHS[name]} />
    </svg>
  );
}

function toggleMuted(setMuted: Dispatch<SetStateAction<boolean>>): void {
  setMuted((value) => !value);
}

// Reads the video's own `paused` flag (not a parallel copy), kept in sync via the onPlay/
// onPause handlers below, so this stays correct whether playback last changed via this
// click or via useVideoAutoplay changing it independently.
function togglePlayback(videoRef: RefObject<HTMLVideoElement | null>): void {
  const video = videoRef.current;
  if (!video) {
    return;
  }
  if (video.paused) {
    video.play()?.catch(() => {});
  } else {
    video.pause();
  }
}

// A video post's playback: autoplay-on-scroll (useVideoAutoplay) starts/pauses it muted as
// it crosses the visibility threshold (FR-008); the poster stays shown until a frame actually
// paints, so there is no layout jump either way. playsInline keeps playback eligible inline on
// mobile; the buttons replace the native `controls` UI (US1 placeholder).
function VideoMedia({ media }: { media: VideoFeedMedia }) {
  const [muted, setMuted] = useState(true);
  const [paused, setPaused] = useState(true);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  useVideoAutoplay(videoRef);

  return (
    <div className="meme-media meme-media--video-wrap">
      <video
        ref={videoRef}
        className="meme-media__video"
        poster={media.src}
        muted={muted}
        playsInline
        loop
        onPlay={() => setPaused(false)}
        onPause={() => setPaused(true)}
        width={media.width}
        height={media.height}
      >
        <source src={media.videoSrc} type={media.mime} />
      </video>
      <div className="meme-media__video-controls">
        <button
          type="button"
          className="meme-media__video-btn"
          aria-label={muted ? 'Unmute' : 'Mute'}
          onClick={() => toggleMuted(setMuted)}
        >
          <VideoGlyph name={muted ? 'unmute' : 'mute'} />
        </button>
        <button
          type="button"
          className="meme-media__video-btn"
          aria-label={paused ? 'Play' : 'Pause'}
          onClick={() => togglePlayback(videoRef)}
        >
          <VideoGlyph name={paused ? 'play' : 'pause'} />
        </button>
      </div>
    </div>
  );
}

// YouTube ⇒ sanitized <iframe> built only from the parsed embed URL (Principle VI).
function YoutubeMedia({ media }: { media: YoutubeFeedMedia }) {
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

// Renders one post's media. `none` ⇒ nothing (the FeedItem still shows the title). A
// runtime-broken image degrades to title-only rather than leaving a broken-image element
// (spec edge case). `linkTo` (feed only) wraps the image in a permalink; YouTube and video
// stay unwrapped — clicks land in the iframe, and the video post has its own controls.
function MemeMedia({ media, linkTo }: { media: FeedMedia; linkTo?: string }) {
  const [isBroken, setIsBroken] = useState(false);

  if (media.kind === 'youtube') {
    return <YoutubeMedia media={media} />;
  }

  if (media.kind === 'video') {
    return <VideoMedia media={media} />;
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
