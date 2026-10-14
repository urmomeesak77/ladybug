// @vitest-environment jsdom
import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useScrollRestoration } from '../../src/hooks/useScrollRestoration';
import { FeedCache } from '../../src/lib/feedCache';

const CACHE_KEY = 'ladybug.feed:/test';

function saveAnchor(anchorHash: string, anchorOffset: number): void {
  FeedCache.writeAnchor(sessionStorage, CACHE_KEY, { anchorHash, anchorOffset });
}

// A minimal feed list whose item tops are controllable: jsdom has no layout, so
// getBoundingClientRect is stubbed per item via a data attribute.
function mountFeedList(hashes: string[]): void {
  document.body.innerHTML = `<ul class="feed__list">${
    hashes.map((hash, i) => `<li data-hash="${hash}" data-top="${i * 100}"></li>`).join('')
  }</ul>`;
  const items = document.querySelectorAll<HTMLElement>('.feed__list > li');
  items.forEach((el) => {
    el.getBoundingClientRect = () => ({ top: Number(el.dataset.top) } as DOMRect);
  });
}

beforeEach(() => {
  sessionStorage.clear();
  vi.stubGlobal('scrollTo', vi.fn());
  // jsdom ships no CSS.escape; identity is safe here since hashes are [A-Za-z0-9-_].
  vi.stubGlobal('CSS', { escape: (value: string) => value });
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

describe('useScrollRestoration', () => {
  it('scrolls to the top when there is no saved anchor', () => {
    renderHook(() => useScrollRestoration(CACHE_KEY, false));

    expect(window.scrollTo).toHaveBeenCalledWith(0, 0);
  });

  it('re-pins the saved anchor post with its offset', () => {
    mountFeedList(['aaa0000001', 'bbb0000002']);
    saveAnchor('bbb0000002', 40);

    renderHook(() => useScrollRestoration(CACHE_KEY, false));

    // Item top (100) + saved offset (40); never a raw stored pixel value.
    expect(window.scrollTo).toHaveBeenCalledWith(0, 140);
  });

  it('ignores the saved anchor and scrolls to the top when fresh', () => {
    mountFeedList(['aaa0000001', 'bbb0000002']);
    saveAnchor('bbb0000002', 40);

    renderHook(() => useScrollRestoration(CACHE_KEY, true));

    expect(window.scrollTo).toHaveBeenCalledWith(0, 0);
  });

  it('captures the current anchor when the feed unmounts', () => {
    mountFeedList(['aaa0000001', 'bbb0000002']);
    const { unmount } = renderHook(() => useScrollRestoration(CACHE_KEY, false));

    unmount();

    expect(FeedCache.readAnchor(sessionStorage, CACHE_KEY)?.anchorHash).toBe('aaa0000001');
  });

  it('captures the anchor on pagehide (refresh / tab close)', () => {
    mountFeedList(['aaa0000001']);
    renderHook(() => useScrollRestoration(CACHE_KEY, false));

    window.dispatchEvent(new Event('pagehide'));

    expect(FeedCache.readAnchor(sessionStorage, CACHE_KEY)?.anchorHash).toBe('aaa0000001');
  });

  it('captures the anchor after scrolling settles (throttled)', () => {
    vi.useFakeTimers();
    try {
      mountFeedList(['aaa0000001']);
        renderHook(() => useScrollRestoration(CACHE_KEY, false));

      window.dispatchEvent(new Event('scroll'));
      vi.advanceTimersByTime(200);

      expect(FeedCache.readAnchor(sessionStorage, CACHE_KEY)?.anchorHash).toBe('aaa0000001');
    } finally {
      vi.useRealTimers();
    }
  });

  // A 200-post snapshot re-encoded every 150 ms of scrolling was the cost being removed: a
  // scroll tick may only write the small anchor entry, never the post list.
  it('never rewrites the post snapshot on a scroll tick', () => {
    vi.useFakeTimers();
    try {
      mountFeedList(['aaa0000001', 'bbb0000002']);
      FeedCache.writeSnapshot(sessionStorage, CACHE_KEY, { posts: [], status: 'loaded' });
      renderHook(() => useScrollRestoration(CACHE_KEY, false));
      const setItem = vi.spyOn(Storage.prototype, 'setItem');

      window.dispatchEvent(new Event('scroll'));
      vi.advanceTimersByTime(200);

      // A Set: hooks rendered by earlier cases in this file are still mounted and listening.
      const writtenKeys = new Set(setItem.mock.calls.map(([key]) => key));
      expect(writtenKeys).toEqual(new Set([FeedCache.anchorKey(CACHE_KEY)]));
    } finally {
      vi.useRealTimers();
    }
  });

  // Items wholly below the viewport top can never be the anchor, so measuring them (a
  // layout read each) is wasted work on a page of up to 200 posts.
  it('stops measuring items once it passes the viewport top', () => {
    mountFeedList(['aaa0000001', 'bbb0000002', 'ccc0000003', 'ddd0000004', 'eee0000005']);
    vi.stubGlobal('scrollY', 150);
    const measured: string[] = [];
    document.querySelectorAll<HTMLElement>('.feed__list > li').forEach((el) => {
      // Viewport-relative, as a real rect is: document top minus the scroll offset.
      el.getBoundingClientRect = () => {
        measured.push(el.dataset.hash ?? '');
        return { top: Number(el.dataset.top) - 150 } as DOMRect;
      };
    });
    const { unmount } = renderHook(() => useScrollRestoration(CACHE_KEY, false));
    measured.length = 0;

    unmount();

    // Document tops are 0, 100, 200, …; at scrollY 150 the anchor is b, 50px scrolled past.
    expect(FeedCache.readAnchor(sessionStorage, CACHE_KEY)).toEqual({ anchorHash: 'bbb0000002', anchorOffset: 50 });
    expect(measured).toEqual(['aaa0000001', 'bbb0000002', 'ccc0000003']);
  });
});
