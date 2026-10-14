import { useEffect, useLayoutEffect } from 'react';

import { FeedCache } from '../lib/feedCache';
import { ScrollAnchor } from '../lib/scrollAnchor';
import type { ItemRect } from '../lib/scrollAnchor';

const THROTTLE_MS = 150;

// Document-absolute tops of the rendered feed items, paired with their hashes, in list
// order — up to and including the first item that starts below the viewport top. Nothing
// past it can be the anchor (ScrollAnchor.pickAnchor stops there too), so measuring the
// rest of a 200-post page would be wasted layout reads on every scroll tick. Bails out
// once the list is detached (e.g. mid-unmount) so a teardown capture can never overwrite
// a good anchor with zeroed rects.
function collectItemRects(scrollY: number): ItemRect[] {
  const list = document.querySelector('.feed__list');
  if (!list || !list.isConnected) {
    return [];
  }
  const rects: ItemRect[] = [];
  for (const el of document.querySelectorAll<HTMLElement>('.feed__list > li[data-hash]')) {
    const top = el.getBoundingClientRect().top + scrollY;
    rects.push({ hash: el.dataset.hash ?? '', top });
    if (top > scrollY) {
      break;
    }
  }
  return rects;
}

// Persist the post currently at the viewport top as the restore anchor, under its own
// small key — never a rewrite of the stored post list. No-op when the list is gone.
function captureAnchor(cacheKey: string): void {
  const scrollY = window.scrollY;
  const anchor = ScrollAnchor.pickAnchor(collectItemRects(scrollY), scrollY);
  if (anchor) {
    FeedCache.writeAnchor(sessionStorage, cacheKey, anchor);
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
// `fresh` (a link navigation, not history traversal) skips the saved anchor entirely:
// the user asked for the page anew, so they start at the top.
export function useScrollRestoration(cacheKey: string, fresh: boolean): void {
  // Restore before paint so the user never sees a flash at the top.
  useLayoutEffect(() => {
    const anchor = fresh ? null : FeedCache.readAnchor(sessionStorage, cacheKey);
    const target = ScrollAnchor.pickRestoreTarget(anchor);
    if (target.kind === 'top') {
      // A fresh page (e.g. reached via "Load more") starts at the top; with manual
      // scrollRestoration it would otherwise keep the previous page's clamped position.
      window.scrollTo(0, 0);
      return;
    }
    const { hash, offset } = target;
    const el = scrollToAnchor(hash, offset);
    // The anchor's lazy image may still grow the element; re-pin once it loads.
    const img = el?.querySelector('img');
    if (img && !img.complete) {
      const reapply = () => scrollToAnchor(hash, offset);
      img.addEventListener('load', reapply, { once: true });
      return () => img.removeEventListener('load', reapply);
    }
  }, [cacheKey, fresh]);

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
