// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useInViewport } from '../../src/hooks/useInViewport';

type EntryInit = {
  isIntersecting: boolean;
  ratio?: number;
  visibleHeight?: number;
  rootHeight?: number | null;
};

// jsdom has no IntersectionObserver; instances are captured so tests can drive visibility
// directly, following the pattern of useVideoAutoplay.test.tsx.
class MockIntersectionObserver {
  static instances: MockIntersectionObserver[] = [];
  callback: IntersectionObserverCallback;
  options: IntersectionObserverInit | undefined;
  observed: Element[] = [];
  disconnected = false;

  constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
    this.callback = callback;
    this.options = options;
    MockIntersectionObserver.instances.push(this);
  }

  observe(target: Element): void {
    this.observed.push(target);
  }

  disconnect(): void {
    this.disconnected = true;
  }

  fire(init: EntryInit): void {
    const rootBounds = init.rootHeight === null ? null : { height: init.rootHeight ?? 800 };
    this.callback(
      [
        {
          isIntersecting: init.isIntersecting,
          intersectionRatio: init.ratio ?? 0,
          intersectionRect: { height: init.visibleHeight ?? 0 } as DOMRectReadOnly,
          rootBounds: rootBounds as DOMRectReadOnly | null,
        } as IntersectionObserverEntry,
      ],
      this as unknown as IntersectionObserver,
    );
  }
}

function visibilityObserver(): MockIntersectionObserver {
  return MockIntersectionObserver.instances[0];
}

function nearnessObserver(): MockIntersectionObserver {
  return MockIntersectionObserver.instances[1];
}

function renderForNode(node: Element | null) {
  return renderHook(({ target }: { target: Element | null }) => useInViewport(target), {
    initialProps: { target: node },
  });
}

beforeEach(() => {
  vi.stubGlobal('IntersectionObserver', MockIntersectionObserver);
  MockIntersectionObserver.instances = [];
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('useInViewport visibility', () => {
  it('counts a post as visible once half of it is on screen', () => {
    const { result } = renderForNode(document.createElement('img'));

    act(() => visibilityObserver().fire({ isIntersecting: true, ratio: 0.5, visibleHeight: 100 }));

    expect(result.current.isVisible).toBe(true);
  });

  it('counts a meme taller than the screen as visible once it covers half the window', () => {
    const { result } = renderForNode(document.createElement('img'));

    // A three-screen-tall meme crosses "half the window covered" at a ratio near 0.17, far
    // below the 0.5 test — FR-011's second rule is what keeps it from staying frozen.
    act(() => visibilityObserver().fire({
      isIntersecting: true,
      ratio: 0.17,
      visibleHeight: 400,
      rootHeight: 800,
    }));

    expect(result.current.isVisible).toBe(true);
  });

  it('stays invisible while it fails both tests', () => {
    const { result } = renderForNode(document.createElement('img'));

    act(() => visibilityObserver().fire({
      isIntersecting: true,
      ratio: 0.2,
      visibleHeight: 100,
      rootHeight: 800,
    }));

    expect(result.current.isVisible).toBe(false);
  });

  it('falls back to the window height when the root has no bounds', () => {
    const { result } = renderForNode(document.createElement('img'));

    act(() => visibilityObserver().fire({
      isIntersecting: true,
      ratio: 0.1,
      visibleHeight: window.innerHeight / 2,
      rootHeight: null,
    }));

    expect(result.current.isVisible).toBe(true);
  });

  it('turns invisible as soon as the ratio falls back under a half', () => {
    // Deliberately UNLIKE useVideoAutoplay, which branches on isIntersecting alone and so
    // keeps playing until the post has left the viewport entirely. An image freezes at the
    // boundary in both directions (FR-004, research R5) — do not "fix" this into parity.
    const { result } = renderForNode(document.createElement('img'));

    act(() => visibilityObserver().fire({ isIntersecting: true, ratio: 0.6, visibleHeight: 300 }));
    expect(result.current.isVisible).toBe(true);

    act(() => visibilityObserver().fire({ isIntersecting: true, ratio: 0.3, visibleHeight: 150 }));
    expect(result.current.isVisible).toBe(false);
  });

  it('declares a threshold ladder fine enough for the tall-meme rule to fire', () => {
    renderForNode(document.createElement('img'));

    const thresholds = visibilityObserver().options?.threshold as number[];
    expect(Array.isArray(thresholds)).toBe(true);
    expect(thresholds[0]).toBe(0);
    expect(thresholds[thresholds.length - 1]).toBe(1);
    // A hair over 0.02 to absorb float noise — the point is the granularity, not the exact
    // step: a tall meme must get a callback near ratio 0.17.
    for (let step = 1; step < thresholds.length; step += 1) {
      expect(thresholds[step] - thresholds[step - 1]).toBeLessThan(0.021);
    }
  });
});

describe('useInViewport acquisition margin', () => {
  it('reports nearness from a root expanded by a full viewport', () => {
    const { result } = renderForNode(document.createElement('img'));

    expect(nearnessObserver().options?.rootMargin).toBe('100% 0px');

    act(() => nearnessObserver().fire({ isIntersecting: true }));
    expect(result.current.isNear).toBe(true);

    act(() => nearnessObserver().fire({ isIntersecting: false }));
    expect(result.current.isNear).toBe(false);
  });
});

describe('useInViewport lifecycle', () => {
  it('observes the node it is given', () => {
    const image = document.createElement('img');
    renderForNode(image);

    expect(visibilityObserver().observed).toEqual([image]);
    expect(nearnessObserver().observed).toEqual([image]);
  });

  it('constructs no observers at all for a null node', () => {
    renderForNode(null);

    expect(MockIntersectionObserver.instances).toHaveLength(0);
  });

  it('re-arms both observers when the node is swapped for the canvas', () => {
    const image = document.createElement('img');
    const canvas = document.createElement('canvas');
    const { rerender } = renderForNode(image);

    rerender({ target: canvas });

    expect(MockIntersectionObserver.instances).toHaveLength(4);
    expect(MockIntersectionObserver.instances[0].disconnected).toBe(true);
    expect(MockIntersectionObserver.instances[1].disconnected).toBe(true);
    expect(MockIntersectionObserver.instances[2].observed).toEqual([canvas]);
    expect(MockIntersectionObserver.instances[3].observed).toEqual([canvas]);
  });

  it('disconnects both observers on unmount', () => {
    const { unmount } = renderForNode(document.createElement('img'));

    unmount();

    expect(visibilityObserver().disconnected).toBe(true);
    expect(nearnessObserver().disconnected).toBe(true);
  });
});
