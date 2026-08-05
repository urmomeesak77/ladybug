import { useEffect } from 'react';
import type { RefObject } from 'react';

// Roughly half the element must be visible before it counts as "in view" — a sliver at the
// viewport edge should not start playback.
const VISIBILITY_THRESHOLD = 0.5;

// Autoplay-on-scroll for one video post (FR-008): mirrors Feed.tsx's sentinel
// IntersectionObserver but observes the video element itself and toggles play/pause
// repeatedly as it crosses the mid-range visibility threshold, rather than firing once.
export function useVideoAutoplay(ref: RefObject<HTMLVideoElement | null>): void {
  useEffect(() => {
    const video = ref.current;
    if (!video) {
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          video.play()?.catch(() => {});
        } else {
          video.pause();
        }
      },
      { threshold: VISIBILITY_THRESHOLD },
    );
    observer.observe(video);
    return () => observer.disconnect();
  }, [ref]);
}
