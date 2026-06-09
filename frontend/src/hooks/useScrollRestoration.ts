import { useEffect, useLayoutEffect } from 'react';

import { readSnapshot, updateSnapshot } from '../lib/feedCache';
import { pickAnchor } from '../lib/scrollAnchor';
import type { ItemRect } from '../lib/scrollAnchor';

const THROTTLE_MS = 150;

// Document-absolute top of every rendered feed item, paired with its hash. Bails out
// once the list is detached (e.g. mid-unmount) so a teardown capture can never overwrite
// a good anchor with zeroed rects.
function collectItemRects(): ItemRect[] {
  const list = document.querySelector('.feed__list');
  if (!list || !list.isConnected) {
    return [];
  }
  const els = document.querySelectorAll<HTMLElement>('.feed__list > li[data-hash]');
  return Array.from(els, (el) => ({
    hash: el.dataset.hash ?? '',
    top: el.getBoundingClientRect().top + window.scrollY,
  }));
}

// Persist the post currently at the viewport top as the restore anchor. No-op until the
// feed hook has written the snapshot (updateSnapshot) or when the list is gone.
function captureAnchor(cacheKey: string): void {
  const anchor = pickAnchor(collectItemRects(), window.scrollY);
  if (anchor) {
    updateSnapshot(sessionStorage, cacheKey, anchor);
  }
}

function scrollToAnchor(hash: string, offset: number): HTMLElement | null {
  const el = document.querySelector<HTMLElement>(`.feed__list > li[data-hash="${CSS.escape(hash)}"]`);
  if (!el) {
    return null;
  }
  const top = el.getBoundingClientRect().top + window.scrollY;
  window.scrollTo(0, top + offset);
  return el;
}

// Restores the feed scroll position on Back/Forward/refresh and keeps the saved anchor
// current as the user scrolls. Anchor-based so lazy images (no reserved height) cannot
// throw off the restore: we pin a specific post to the viewport top, not a raw pixel.
export function useScrollRestoration(cacheKey: string): void {
  // Restore before paint so the user never sees a flash at the top.
  useLayoutEffect(() => {
    const snapshot = readSnapshot(sessionStorage, cacheKey);
    if (!snapshot?.anchorHash) {
      return;
    }
    if ('scrollRestoration' in history) {
      history.scrollRestoration = 'manual';
    }
    const { anchorHash, anchorOffset } = snapshot;
    const el = scrollToAnchor(anchorHash, anchorOffset);
    // The anchor's lazy image may still grow the element; re-pin once it loads.
    const img = el?.querySelector('img');
    if (img && !img.complete) {
      const reapply = () => scrollToAnchor(anchorHash, anchorOffset);
      img.addEventListener('load', reapply, { once: true });
      return () => img.removeEventListener('load', reapply);
    }
  }, [cacheKey]);

  // Flush the final anchor when the feed unmounts. SPA Link navigation to a post does not
  // fire pagehide and cancels the throttled scroll timer, so without this the last scroll
  // position would be lost. A layout-effect cleanup runs while the list DOM is still
  // connected (a passive-effect cleanup runs too late, after detach).
  useLayoutEffect(() => {
    return () => captureAnchor(cacheKey);
  }, [cacheKey]);

  // Keep the anchor current as the user scrolls (throttled) and on pagehide (refresh /
  // tab close).
  useEffect(() => {
    let timer: number | undefined;
    const onScroll = () => {
      if (timer !== undefined) {
        return;
      }
      timer = window.setTimeout(() => {
        timer = undefined;
        captureAnchor(cacheKey);
      }, THROTTLE_MS);
    };
    const onPageHide = () => captureAnchor(cacheKey);
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('pagehide', onPageHide);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('pagehide', onPageHide);
      if (timer !== undefined) {
        window.clearTimeout(timer);
      }
    };
  }, [cacheKey]);
}
