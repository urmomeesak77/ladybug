// @vitest-environment jsdom
import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useScrollRestoration } from '../../src/hooks/useScrollRestoration';
import { FeedCache } from '../../src/lib/feedCache';
import type { FeedSnapshot } from '../../src/lib/feedCache';

const CACHE_KEY = 'ladybug.feed:/test';

function snapshot(overrides: Partial<FeedSnapshot>): FeedSnapshot {
  return { posts: [], cursor: undefined, status: 'loaded', anchorHash: null, anchorOffset: 0, ...overrides };
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
    renderHook(() => useScrollRestoration(CACHE_KEY));

    expect(window.scrollTo).toHaveBeenCalledWith(0, 0);
  });

  it('re-pins the saved anchor post with its offset', () => {
    mountFeedList(['aaa0000001', 'bbb0000002']);
    FeedCache.writeSnapshot(sessionStorage, CACHE_KEY, snapshot({
      anchorHash: 'bbb0000002',
      anchorOffset: 40,
    }));

    renderHook(() => useScrollRestoration(CACHE_KEY));

    // Item top (100) + saved offset (40); never a raw stored pixel value.
    expect(window.scrollTo).toHaveBeenCalledWith(0, 140);
  });

  it('captures the current anchor into the snapshot when the feed unmounts', () => {
    mountFeedList(['aaa0000001', 'bbb0000002']);
    FeedCache.writeSnapshot(sessionStorage, CACHE_KEY, snapshot({ anchorHash: null }));
    const { unmount } = renderHook(() => useScrollRestoration(CACHE_KEY));

    unmount();

    const saved = FeedCache.readSnapshot(sessionStorage, CACHE_KEY);
    expect(saved?.anchorHash).toBe('aaa0000001');
  });

  it('captures the anchor on pagehide (refresh / tab close)', () => {
    mountFeedList(['aaa0000001']);
    FeedCache.writeSnapshot(sessionStorage, CACHE_KEY, snapshot({ anchorHash: null }));
    renderHook(() => useScrollRestoration(CACHE_KEY));

    window.dispatchEvent(new Event('pagehide'));

    expect(FeedCache.readSnapshot(sessionStorage, CACHE_KEY)?.anchorHash).toBe('aaa0000001');
  });

  it('captures the anchor after scrolling settles (throttled)', () => {
    vi.useFakeTimers();
    try {
      mountFeedList(['aaa0000001']);
      FeedCache.writeSnapshot(sessionStorage, CACHE_KEY, snapshot({ anchorHash: null }));
      renderHook(() => useScrollRestoration(CACHE_KEY));

      window.dispatchEvent(new Event('scroll'));
      vi.advanceTimersByTime(200);

      expect(FeedCache.readSnapshot(sessionStorage, CACHE_KEY)?.anchorHash).toBe('aaa0000001');
    } finally {
      vi.useRealTimers();
    }
  });
});
