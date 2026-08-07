import { useEffect, useLayoutEffect, useRef, useState } from 'react';

import { AnimatedImage } from '../lib/animatedImage';
import { AnimationPlayer } from '../lib/animationPlayer';
import { AnimationRegistry } from '../lib/animationRegistry';
import { useInViewport } from './useInViewport';

export type FrameSize = { width: number; height: number };

// Decode the frame the post should be showing, which doubles as the takeover's size probe:
// the canvas has to be created at the frame's own intrinsic dimensions (FR-009).
async function decodeHeldFrame(url: string): Promise<VideoFrame | null> {
  const session = await AnimationRegistry.acquire(url);
  if (!session) {
    return null;
  }
  try {
    const result = await session.decoder.decode({
      frameIndex: AnimationRegistry.position(url).frameIndex,
      completeFramesOnly: true,
    });
    return result.image;
  } catch {
    return null;
  }
}

// Glue between one post's element and its playback: probe on approach, swap the <img> for a
// <canvas> once the file proves animated, and start/stop the player as the post crosses the
// visibility rule. Everything is discovered here in the browser — no API field, no stored
// flag (FR-016) — and every failure path simply leaves the <img> alone (FR-012).
export function useAnimatedImage(src: string): {
  setNode: (node: HTMLElement | null) => void;
  takeover: FrameSize | null;
  isPlaying: boolean;
} {
  const [node, setNode] = useState<HTMLElement | null>(null);
  const [takeover, setTakeover] = useState<FrameSize | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isPageVisible, setIsPageVisible] = useState(() => !document.hidden);
  const [sourceTick, setSourceTick] = useState(0);
  const probe = useRef({ hasProbed: false, url: '' });
  const heldFrame = useRef<VideoFrame | null>(null);
  const player = useRef<AnimationPlayer | null>(null);

  // Both cheap synchronous gates come FIRST, and an ineligible post is handed a null node:
  // that way a JPEG feed, and every post on a browser without ImageDecoder, constructs no
  // IntersectionObserver at all rather than 51-threshold ladders doing nothing (research R5).
  const isEligible = AnimatedImage.isSupported() && AnimatedImage.isCandidate(src);
  const { isVisible, isNear } = useInViewport(isEligible ? node : null);

  useEffect(() => {
    if (!isEligible) {
      return;
    }
    const onVisibilityChange = () => setIsPageVisible(!document.hidden);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, [isEligible]);

  useEffect(() => {
    if (!isEligible || !isNear || !node || probe.current.hasProbed) {
      return;
    }
    // The URL to probe is the variant the element actually selected, never media.src: feed
    // images carry a multi-candidate srcset, so probing media.src would download bytes the
    // visitor never sees and size the canvas from the wrong variant (research R4).
    const url = (node as HTMLImageElement).currentSrc;
    if (!url) {
      // A lazy <img> has no currentSrc until the browser starts fetching it.
      const onLoad = () => setSourceTick((tick) => tick + 1);
      node.addEventListener('load', onLoad, { once: true });
      return () => node.removeEventListener('load', onLoad);
    }
    probe.current = { hasProbed: true, url };
    let isCancelled = false;
    void decodeHeldFrame(url).then((frame) => {
      if (!frame) {
        // Still image, or any failure: hasProbed stays true, so this post is now a plain
        // <img> for the life of the page and is never asked again (FR-008/FR-012).
        return;
      }
      if (isCancelled) {
        frame.close();
        return;
      }
      heldFrame.current = frame;
      setTakeover({ width: frame.displayWidth, height: frame.displayHeight });
    });
    return () => {
      isCancelled = true;
    };
  }, [isEligible, isNear, node, sourceTick]);

  // Before the browser paints the swapped-in canvas, so there is never a painted frame in
  // which it is blank (research R8 mechanic 1, SC-008).
  useLayoutEffect(() => {
    const frame = heldFrame.current;
    if (!frame || !(node instanceof HTMLCanvasElement)) {
      return;
    }
    heldFrame.current = null;
    node.getContext('2d')?.drawImage(frame, 0, 0);
    frame.close();
  }, [takeover, node]);

  useEffect(() => {
    if (!takeover || !(node instanceof HTMLCanvasElement)) {
      return;
    }
    // The callback is the SINGLE source of isPlaying — reading it back after start()/stop()
    // would miss the transition that matters most: a file whose repeat allowance runs out
    // stops itself part-way through the frame chain (FR-003a), with nobody here to observe
    // it, leaving a post resting on its final frame still claiming data-playing="true".
    player.current ??= new AnimationPlayer(probe.current.url, node, () => {
      setIsPlaying(player.current?.isPlaying ?? false);
    });
    const active = player.current;
    // A hidden tab counts as not visible: our own timer would otherwise limp on at the
    // browser's background throttle, spending a play-once meme for nobody (FR-002a, R16).
    if (isVisible && isPageVisible) {
      active.start();
    } else {
      active.stop();
    }
  }, [takeover, node, isVisible, isPageVisible]);

  // Unmount only — navigating away stops the timer but deliberately leaves the decoder in
  // the registry, so a Back navigation resumes instantly (research R9).
  useEffect(() => {
    return () => {
      player.current?.stop();
      player.current = null;
      heldFrame.current?.close();
      heldFrame.current = null;
    };
  }, []);

  return { setNode, takeover, isPlaying };
}
