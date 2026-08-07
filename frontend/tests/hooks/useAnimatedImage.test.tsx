// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useAnimatedImage } from '../../src/hooks/useAnimatedImage';
import { AnimationRegistry } from '../../src/lib/animationRegistry';

const MEME_SRC = '/storage/meme.gif';
const SELECTED_SRC = '/storage/meme-640.gif';

let currentSrc = SELECTED_SRC;
let isPageHidden = false;
let trackAnimated = true;
let trackRepetitionCount: number = Infinity;
let decodedIndexes: number[] = [];
// Every canvas operation in order, so a test can assert the post was never left showing a
// cleared (blank) canvas — a clearRect that is not immediately followed by a drawImage.
let paintLog: string[] = [];
let fetchMock: ReturnType<typeof vi.fn>;

// jsdom provides neither ImageDecoder nor a canvas 2D context, so both are stubbed and the
// real AnimatedImage / AnimationRegistry / AnimationPlayer chain runs underneath the hook
// (research R11). That keeps "zero fetches" assertions meaningful.
class FakeImageDecoder {
  static isTypeSupported = vi.fn(() => Promise.resolve(true));

  tracks = {
    ready: Promise.resolve(),
    selectedTrack: { animated: trackAnimated, frameCount: 4, repetitionCount: trackRepetitionCount },
  };
  completed = Promise.resolve();
  close = vi.fn();
  decode = vi.fn((options: { frameIndex: number }) => {
    decodedIndexes.push(options.frameIndex);
    return Promise.resolve({
      image: { displayWidth: 640, displayHeight: 480, duration: 40_000, close: vi.fn() },
    });
  });
}

class MockIntersectionObserver {
  static instances: MockIntersectionObserver[] = [];
  callback: IntersectionObserverCallback;
  observed: Element[] = [];

  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback;
    MockIntersectionObserver.instances.push(this);
  }

  observe(target: Element): void {
    this.observed.push(target);
  }

  disconnect(): void {}

  fire(isIntersecting: boolean): void {
    this.callback(
      [
        {
          isIntersecting,
          intersectionRatio: isIntersecting ? 1 : 0,
          intersectionRect: { height: isIntersecting ? 480 : 0 } as DOMRectReadOnly,
          rootBounds: { height: 800 } as DOMRectReadOnly,
        } as IntersectionObserverEntry,
      ],
      this as unknown as IntersectionObserver,
    );
  }
}

// The hook re-arms both observers when the element is swapped, so the pair driving the
// element currently on screen is always the last two constructed.
function visibilityObserver(): MockIntersectionObserver {
  const { instances } = MockIntersectionObserver;
  return instances[instances.length - 2];
}

function nearnessObserver(): MockIntersectionObserver {
  const { instances } = MockIntersectionObserver;
  return instances[instances.length - 1];
}

function Harness({ src }: { src: string }) {
  const { setNode, takeover, isPlaying } = useAnimatedImage(src);
  if (takeover) {
    return (
      <canvas
        ref={setNode}
        data-testid="canvas"
        data-playing={isPlaying}
        width={takeover.width}
        height={takeover.height}
      />
    );
  }
  return <img ref={setNode} data-testid="image" src={src} alt="A meme" />;
}

async function settle(): Promise<void> {
  await act(async () => {
    for (let turn = 0; turn < 20; turn += 1) {
      await Promise.resolve();
    }
  });
}

async function fireNear(): Promise<void> {
  act(() => nearnessObserver().fire(true));
  await settle();
}

async function fireVisible(isVisible: boolean): Promise<void> {
  act(() => visibilityObserver().fire(isVisible));
  await settle();
}

async function firePageVisibility(isHidden: boolean): Promise<void> {
  isPageHidden = isHidden;
  act(() => {
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await settle();
}

// Reaches takeover: the post approaches, the probe succeeds and the canvas replaces the img.
async function takeOver(): Promise<void> {
  await fireNear();
}

// Real elapsed time, so the frame chain actually advances and the remembered position is a
// frame the visitor was shown rather than the initial zero.
async function advanceFrames(milliseconds: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(milliseconds);
  });
}

function hasBlankPaint(): boolean {
  for (let index = 0; index < paintLog.length; index += 1) {
    if (paintLog[index] === 'clear' && paintLog[index + 1] !== 'draw') {
      return true;
    }
  }
  return false;
}

// Pushes the post out of the LRU by acquiring more sessions than the registry's cap, the way
// a long scroll past other animated posts would.
async function evictSessions(): Promise<void> {
  await act(async () => {
    for (let index = 0; index < 12; index += 1) {
      void AnimationRegistry.acquire(`/storage/other-${index}.gif`);
    }
  });
  await settle();
}

beforeEach(() => {
  currentSrc = SELECTED_SRC;
  isPageHidden = false;
  trackAnimated = true;
  trackRepetitionCount = Infinity;
  decodedIndexes = [];
  paintLog = [];
  MockIntersectionObserver.instances = [];
  AnimationRegistry.reset();
  fetchMock = vi.fn(() =>
    Promise.resolve(
      new Response(new ArrayBuffer(8), { headers: { 'Content-Type': 'image/gif' } }),
    ),
  );
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('IntersectionObserver', MockIntersectionObserver);
  Object.defineProperty(HTMLImageElement.prototype, 'currentSrc', {
    configurable: true,
    get: () => currentSrc,
  });
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => isPageHidden });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    clearRect: vi.fn(() => paintLog.push('clear')),
    drawImage: vi.fn(() => paintLog.push('draw')),
  } as unknown as CanvasRenderingContext2D);
});

afterEach(() => {
  cleanup();
  AnimationRegistry.reset();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('useAnimatedImage gating', () => {
  it('leaves the image alone, unobserved and unfetched, without ImageDecoder', async () => {
    const { getByTestId } = render(<Harness src={MEME_SRC} />);
    await settle();

    expect(getByTestId('image')).toBeTruthy();
    expect(MockIntersectionObserver.instances).toHaveLength(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('leaves a JPEG alone, unobserved and unfetched', async () => {
    vi.stubGlobal('ImageDecoder', FakeImageDecoder);

    const { getByTestId } = render(<Harness src="/storage/meme.jpg" />);
    await settle();

    expect(getByTestId('image')).toBeTruthy();
    expect(MockIntersectionObserver.instances).toHaveLength(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('useAnimatedImage probing', () => {
  beforeEach(() => {
    vi.stubGlobal('ImageDecoder', FakeImageDecoder);
  });

  it('probes once on approach and never again', async () => {
    render(<Harness src={MEME_SRC} />);
    await takeOver();

    expect(fetchMock).toHaveBeenCalledTimes(1);

    act(() => nearnessObserver().fire(false));
    await fireNear();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('fetches the variant the element actually selected, not the post src', async () => {
    render(<Harness src={MEME_SRC} />);
    await takeOver();

    expect(fetchMock).toHaveBeenCalledWith(SELECTED_SRC, { cache: 'force-cache' });
    expect(AnimationRegistry.peek(SELECTED_SRC)).not.toBeNull();
    expect(AnimationRegistry.peek(MEME_SRC)).toBeNull();
  });

  it('waits for the lazy image to choose a source, then probes on its load event', async () => {
    currentSrc = '';
    const { getByTestId } = render(<Harness src={MEME_SRC} />);
    await fireNear();

    expect(fetchMock).not.toHaveBeenCalled();

    currentSrc = SELECTED_SRC;
    const image = getByTestId('image');
    act(() => {
      image.dispatchEvent(new Event('load'));
    });
    await settle();

    expect(fetchMock).toHaveBeenCalledWith(SELECTED_SRC, { cache: 'force-cache' });
  });

  it('keeps a still image an <img> forever and never retries the probe', async () => {
    trackAnimated = false;
    const { getByTestId } = render(<Harness src={MEME_SRC} />);
    await takeOver();

    expect(getByTestId('image')).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    act(() => nearnessObserver().fire(false));
    await fireNear();

    expect(getByTestId('image')).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('swaps in a canvas sized from the decoded frame', async () => {
    const { getByTestId } = render(<Harness src={MEME_SRC} />);
    await takeOver();

    const canvas = getByTestId('canvas') as HTMLCanvasElement;
    expect(canvas.width).toBe(640);
    expect(canvas.height).toBe(480);
  });
});

describe('useAnimatedImage playback', () => {
  beforeEach(() => {
    vi.stubGlobal('ImageDecoder', FakeImageDecoder);
  });

  it('plays while visible and freezes on the frame it holds when it leaves', async () => {
    const { getByTestId } = render(<Harness src={MEME_SRC} />);
    await takeOver();

    await fireVisible(true);
    expect(getByTestId('canvas').getAttribute('data-playing')).toBe('true');

    await fireVisible(false);
    expect(getByTestId('canvas').getAttribute('data-playing')).toBe('false');
    expect(AnimationRegistry.position(SELECTED_SRC).isFinished).toBe(false);
  });

  // Nobody calls stop() here — the file's single play-through simply runs out. Observed in
  // Chrome on a real play-once GIF: the canvas correctly came to rest on its final frame
  // while data-playing still said "true", because the hook only ever read isPlaying right
  // after driving the player itself.
  it('stops reporting playing once a play-once file has run out on its own', async () => {
    vi.useFakeTimers();
    trackRepetitionCount = 0;
    const { getByTestId } = render(<Harness src={MEME_SRC} />);
    await takeOver();
    await fireVisible(true);
    expect(getByTestId('canvas').getAttribute('data-playing')).toBe('true');

    await advanceFrames(4 * 100);

    expect(getByTestId('canvas').getAttribute('data-playing')).toBe('false');
    expect(AnimationRegistry.position(SELECTED_SRC).isFinished).toBe(true);
  });

  it('does not start while the page is hidden', async () => {
    isPageHidden = true;
    const { getByTestId } = render(<Harness src={MEME_SRC} />);
    await takeOver();

    await fireVisible(true);

    expect(getByTestId('canvas').getAttribute('data-playing')).toBe('false');
  });

  it('freezes when the tab is backgrounded and resumes on the held frame', async () => {
    const { getByTestId } = render(<Harness src={MEME_SRC} />);
    await takeOver();
    await fireVisible(true);

    await firePageVisibility(true);
    expect(getByTestId('canvas').getAttribute('data-playing')).toBe('false');

    const held = AnimationRegistry.position(SELECTED_SRC).frameIndex;
    decodedIndexes = [];
    await firePageVisibility(false);

    expect(getByTestId('canvas').getAttribute('data-playing')).toBe('true');
    expect(decodedIndexes[0]).toBe(held);
  });

  // SC-008: takeover is one-way. A flick scroll crosses the visibility boundary several times
  // a second, and each crossing re-running the probe or re-creating the element would be both
  // a wasted request and a visible flicker (research R8 mechanic 2).
  it('swaps the element once however often the post crosses the boundary', async () => {
    const { getByTestId } = render(<Harness src={MEME_SRC} />);
    await takeOver();
    const canvas = getByTestId('canvas');

    await fireVisible(true);
    await fireVisible(false);
    await fireVisible(true);
    await fireVisible(false);
    await fireVisible(true);

    expect(getByTestId('canvas')).toBe(canvas);
    expect(document.querySelectorAll('canvas')).toHaveLength(1);
    expect(document.querySelector('img')).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  // FR-019 / SC-011, and the automated stand-in for SC-002's 0.5 s budget: coming back to a
  // post whose decoder was released is one cached request and one decode — not a re-run of
  // the probe — and the frame it lands on is the one it was showing when it left.
  it('re-acquires an evicted session and resumes on its saved frame', async () => {
    vi.useFakeTimers();
    render(<Harness src={MEME_SRC} />);
    await takeOver();
    await fireVisible(true);
    await advanceFrames(100);
    await fireVisible(false);

    const held = AnimationRegistry.position(SELECTED_SRC).frameIndex;
    expect(held).toBeGreaterThan(0);

    await evictSessions();
    expect(AnimationRegistry.peek(SELECTED_SRC)).toBeNull();

    decodedIndexes = [];
    paintLog = [];
    const fetchesBefore = fetchMock.mock.calls.length;
    await fireVisible(true);

    expect(fetchMock.mock.calls.length - fetchesBefore).toBe(1);
    expect(fetchMock).toHaveBeenLastCalledWith(SELECTED_SRC, { cache: 'force-cache' });
    expect(decodedIndexes[0]).toBe(held);
    expect(paintLog).toContain('draw');
    expect(hasBlankPaint()).toBe(false);
  });

  it('stops on unmount, drops its listener and leaves the session cached', async () => {
    const removeListener = vi.spyOn(document, 'removeEventListener');
    const { unmount } = render(<Harness src={MEME_SRC} />);
    await takeOver();
    await fireVisible(true);

    unmount();
    await settle();

    expect(removeListener).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
    expect(AnimationRegistry.peek(SELECTED_SRC)).not.toBeNull();
  });
});
