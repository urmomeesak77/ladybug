// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { useRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useVideoAutoplay } from '../../src/hooks/useVideoAutoplay';

// jsdom has no IntersectionObserver; capture instances so tests can drive visibility directly,
// mirroring Feed.test.tsx's sentinel mock but toggling repeatedly instead of firing once.
class MockIntersectionObserver {
  static instances: MockIntersectionObserver[] = [];
  callback: IntersectionObserverCallback;
  observed: Element[] = [];
  disconnected = false;

  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback;
    MockIntersectionObserver.instances.push(this);
  }

  observe(target: Element): void {
    this.observed.push(target);
  }

  disconnect(): void {
    this.disconnected = true;
  }

  fire(isIntersecting: boolean): void {
    this.callback(
      [{ isIntersecting } as IntersectionObserverEntry],
      this as unknown as IntersectionObserver,
    );
  }
}

function Harness() {
  const ref = useRef<HTMLVideoElement | null>(null);
  useVideoAutoplay(ref);
  return <video ref={ref} data-testid="video" />;
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

describe('useVideoAutoplay', () => {
  it('attaches an IntersectionObserver to the given video element', () => {
    const { getByTestId } = render(<Harness />);

    const observer = MockIntersectionObserver.instances[0];
    expect(observer.observed).toEqual([getByTestId('video')]);
  });

  it('plays the video once it crosses the visibility threshold', () => {
    const { getByTestId } = render(<Harness />);
    const video = getByTestId('video') as HTMLVideoElement;
    const play = vi.spyOn(video, 'play').mockResolvedValue(undefined);

    MockIntersectionObserver.instances[0].fire(true);

    expect(play).toHaveBeenCalled();
  });

  it('pauses the video once it leaves the visibility threshold', () => {
    const { getByTestId } = render(<Harness />);
    const video = getByTestId('video') as HTMLVideoElement;
    vi.spyOn(video, 'play').mockResolvedValue(undefined);
    const pause = vi.spyOn(video, 'pause').mockImplementation(() => {});

    MockIntersectionObserver.instances[0].fire(false);

    expect(pause).toHaveBeenCalled();
  });

  it('disconnects the observer on unmount', () => {
    const { unmount } = render(<Harness />);
    const observer = MockIntersectionObserver.instances[0];

    unmount();

    expect(observer.disconnected).toBe(true);
  });
});
