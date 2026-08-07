import { useEffect, useState } from 'react';

// The same constant useVideoAutoplay uses, so a normally sized animated image STARTS at the
// same scroll position a video does (FR-004).
const VISIBILITY_THRESHOLD = 0.5;

// One viewport above and below: acquisition (decode + swap) happens while the post is still
// off screen, so the canvas is ready before playback is wanted (research R8 mechanic 4).
const NEAR_MARGIN = '100% 0px';

// An IntersectionObserver only fires at the thresholds it was given. The tall-meme rule can
// flip while the ratio barely moves — a meme three screens tall covers half the window at a
// ratio near 0.17 — so a lone `threshold: 0.5` would never fire for it (research R5).
const THRESHOLD_LADDER = Array.from({ length: 51 }, (_, step) => step / 50);

// FR-011's two tests.
//
// How this really compares to the video hook (measured in Chrome, correcting research R5):
// `useVideoAutoplay` declares `threshold: 0.5`, and a threshold makes `isIntersecting`
// itself track that threshold — at ratio 0.25 it reports false, at 0.75 true. So video
// pauses on the SAME half-visible boundary an image freezes on, not on full exit. The one
// real difference is the second test below: a meme taller than twice the window can never
// reach ratio 0.5, so an image keeps playing on the covers-half-the-window rule where a
// video of the same shape would pause. The asymmetry is the opposite way round from the
// original note, and it makes the image MORE forgiving, never less.
function isHalfSeen(entry: IntersectionObserverEntry): boolean {
  if (!entry.isIntersecting) {
    return false;
  }
  if (entry.intersectionRatio >= VISIBILITY_THRESHOLD) {
    return true;
  }
  const viewportHeight = entry.rootBounds?.height ?? window.innerHeight;
  return entry.intersectionRect.height >= viewportHeight * VISIBILITY_THRESHOLD;
}

// Visibility for one animated post: `isVisible` drives playback, `isNear` drives acquisition.
// A null node — a non-candidate post, or any post in a browser without ImageDecoder —
// constructs NO observers at all, which is how a 200-entry JPEG feed pays nothing (research
// R5). Callers must therefore rule a post out before passing its element in.
export function useInViewport(node: Element | null): { isVisible: boolean; isNear: boolean } {
  const [isVisible, setIsVisible] = useState(false);
  const [isNear, setIsNear] = useState(false);

  useEffect(() => {
    if (!node) {
      return;
    }
    const visibility = new IntersectionObserver(
      (entries) => setIsVisible(isHalfSeen(entries[0])),
      { threshold: THRESHOLD_LADDER },
    );
    const nearness = new IntersectionObserver(
      (entries) => setIsNear(entries[0].isIntersecting),
      { rootMargin: NEAR_MARGIN },
    );
    visibility.observe(node);
    nearness.observe(node);
    return () => {
      visibility.disconnect();
      nearness.disconnect();
    };
  }, [node]);

  return { isVisible, isNear };
}
