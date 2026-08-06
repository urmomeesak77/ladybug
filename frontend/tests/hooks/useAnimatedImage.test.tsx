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
let decodedIndexes: number[] = [];
let fetchMock: ReturnType<typeof vi.fn>;

// jsdom provides neither ImageDecoder nor a canvas 2D context, so both are stubbed and the
// real AnimatedImage / AnimationRegistry / AnimationPlayer chain runs underneath the hook
// (research R11). That keeps "zero fetches" assertions meaningful.
class FakeImageDecoder {
  static isTypeSupported = vi.fn(() => Promise.resolve(true));

  tracks = {
    ready: Promise.resolve(),
    selectedTrack: { animated: trackAnimated, frameCount: 4, repetitionCount: Infinity },
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

beforeEach(() => {
  currentSrc = SELECTED_SRC;
  isPageHidden = false;
  trackAnimated = true;
  decodedIndexes = [];
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
    clearRect: vi.fn(),
    drawImage: vi.fn(),
  } as unknown as CanvasRenderingContext2D);
});

afterEach(() => {
  cleanup();
  AnimationRegistry.reset();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
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
