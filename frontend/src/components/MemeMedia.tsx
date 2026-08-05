import { useRef, useState } from 'react';
import type { Dispatch, RefObject, SetStateAction } from 'react';
import { Link } from 'react-router-dom';

import { useVideoAutoplay } from '../hooks/useVideoAutoplay';
import type { FeedMedia } from '../lib/feedModel';

type VideoFeedMedia = Extract<FeedMedia, { kind: 'video' }>;
type YoutubeFeedMedia = Extract<FeedMedia, { kind: 'youtube' }>;

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
        <button type="button" className="meme-media__video-btn" onClick={() => toggleMuted(setMuted)}>
          {muted ? 'Unmute' : 'Mute'}
        </button>
        <button type="button" className="meme-media__video-btn" onClick={() => togglePlayback(videoRef)}>
          {paused ? 'Play' : 'Pause'}
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
