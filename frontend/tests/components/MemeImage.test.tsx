// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import MemeImage from '../../src/components/MemeImage';
import type { ImageFeedMedia } from '../../src/components/MemeMedia';
import { AnimationRegistry } from '../../src/lib/animationRegistry';

const SELECTED_SRC = '/storage/meme-640.gif';

let currentSrc = SELECTED_SRC;
let trackAnimated = true;
let frameWidth = 640;
let frameHeight = 480;
let fetchMock: ReturnType<typeof vi.fn>;

// jsdom has neither ImageDecoder nor a canvas 2D context, so both are stubbed and the real
// AnimatedImage / AnimationRegistry / AnimationPlayer chain runs underneath the component
// (research R11) — the same harness useAnimatedImage.test.tsx uses.
class FakeImageDecoder {
  static isTypeSupported = vi.fn(() => Promise.resolve(true));

  tracks = {
    ready: Promise.resolve(),
    selectedTrack: { animated: trackAnimated, frameCount: 4, repetitionCount: Infinity },
  };
  completed = Promise.resolve();
  close = vi.fn();
  decode = vi.fn(() =>
    Promise.resolve({
      image: {
        displayWidth: frameWidth,
        displayHeight: frameHeight,
        duration: 40_000,
        close: vi.fn(),
      },
    }),
  );
}

class MockIntersectionObserver {
  static instances: MockIntersectionObserver[] = [];
  callback: IntersectionObserverCallback;

  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback;
    MockIntersectionObserver.instances.push(this);
  }

  observe(): void {}

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

// useInViewport constructs the visibility observer first and the nearness one second, and
// re-arms both on the <img> → <canvas> swap, so the live pair is always the last two.
function visibilityObserver(): MockIntersectionObserver {
  const { instances } = MockIntersectionObserver;
  return instances[instances.length - 2];
}

function nearnessObserver(): MockIntersectionObserver {
  const { instances } = MockIntersectionObserver;
  return instances[instances.length - 1];
}

function imageMedia(overrides: Partial<ImageFeedMedia> = {}): ImageFeedMedia {
  return {
    kind: 'image',
    src: '/storage/meme.gif',
    srcset: '/storage/meme-640.gif 640w, /storage/meme-320.gif 320w',
    sizes: '(min-width: 80rem) 80rem, 100vw',
    alt: 'Funny cat',
    width: 800,
    height: 400,
    ...overrides,
  };
}

async function settle(): Promise<void> {
  await act(async () => {
    for (let turn = 0; turn < 20; turn += 1) {
      await Promise.resolve();
    }
  });
}

async function takeOver(): Promise<void> {
  act(() => nearnessObserver().fire(true));
  await settle();
}

async function fireVisible(isVisible: boolean): Promise<void> {
  act(() => visibilityObserver().fire(isVisible));
  await settle();
}

beforeEach(() => {
  currentSrc = SELECTED_SRC;
  trackAnimated = true;
  frameWidth = 640;
  frameHeight = 480;
  MockIntersectionObserver.instances = [];
  AnimationRegistry.reset();
  fetchMock = vi.fn(() =>
    Promise.resolve(new Response(new ArrayBuffer(8), { headers: { 'Content-Type': 'image/gif' } })),
  );
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('IntersectionObserver', MockIntersectionObserver);
  Object.defineProperty(HTMLImageElement.prototype, 'currentSrc', {
    configurable: true,
    get: () => currentSrc,
  });
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

describe('MemeImage before takeover', () => {
  it("renders today's lazy responsive img untouched", () => {
    const { container } = render(<MemeImage media={imageMedia()} />);

    const img = screen.getByRole('img', { name: 'Funny cat' });
    expect(img.className).toBe('meme-media meme-media__image');
    expect(img.getAttribute('src')).toBe('/storage/meme.gif');
    expect(img.getAttribute('srcset')).toContain('320w');
    expect(img.getAttribute('sizes')).toContain('80rem');
    expect(img.getAttribute('width')).toBe('800');
    expect(img.getAttribute('height')).toBe('400');
    expect(img.getAttribute('loading')).toBe('lazy');
    expect(container.querySelector('canvas')).toBeNull();
  });

  it('degrades the post to nothing when the image fails to load', () => {
    const { container } = render(<MemeImage media={imageMedia()} />);

    fireEvent.error(screen.getByRole('img'));

    expect(container.innerHTML).toBe('');
  });
});

describe('MemeImage after takeover', () => {
  beforeEach(() => {
    vi.stubGlobal('ImageDecoder', FakeImageDecoder);
  });

  it('swaps the img for a canvas that keeps the text alternative', async () => {
    render(<MemeImage media={imageMedia()} />);
    await takeOver();

    const canvas = screen.getByRole('img', { name: 'Funny cat' }) as HTMLCanvasElement;
    expect(canvas.tagName).toBe('CANVAS');
    expect(canvas.classList.contains('meme-media')).toBe(true);
    expect(canvas.classList.contains('meme-media__image')).toBe(true);
    expect(canvas.classList.contains('meme-media__canvas')).toBe(true);
  });

  it('sizes the canvas from the decoded frame, not the stored dimensions', async () => {
    render(<MemeImage media={imageMedia()} />);
    await takeOver();

    const canvas = document.querySelector('canvas') as HTMLCanvasElement;
    expect(canvas.getAttribute('width')).toBe('640');
    expect(canvas.getAttribute('height')).toBe('480');
  });

  it('reflects playback state in data-playing as visibility changes', async () => {
    render(<MemeImage media={imageMedia()} />);
    await takeOver();

    await fireVisible(true);
    expect(document.querySelector('canvas')?.getAttribute('data-playing')).toBe('true');

    await fireVisible(false);
    expect(document.querySelector('canvas')?.getAttribute('data-playing')).toBe('false');
  });

  it('adds no control, button or overlay of any kind (FR-013)', async () => {
    const { container } = render(<MemeImage media={imageMedia()} />);
    await takeOver();

    expect(container.querySelectorAll('*')).toHaveLength(1);
    expect(container.querySelector('canvas')).not.toBeNull();
  });
});

describe('MemeImage layout preservation', () => {
  beforeEach(() => {
    vi.stubGlobal('ImageDecoder', FakeImageDecoder);
  });

  // The whole of the layout-shift defence: an <img> with a w-descriptor srcset lays out at
  // the `sizes` width, not the variant's pixel width. A canvas gets no such correction, so
  // without --fluid a small selected variant would shrink the post (research R8 mechanic 3).
  it('marks the canvas fluid when the image carried a srcset', async () => {
    render(<MemeImage media={imageMedia()} />);
    await takeOver();

    expect(document.querySelector('canvas')?.classList.contains('meme-media__canvas--fluid')).toBe(
      true,
    );
  });

  it('leaves the canvas at its intrinsic width when there is no srcset', async () => {
    render(<MemeImage media={imageMedia({ srcset: '' })} />);
    await takeOver();

    expect(document.querySelector('canvas')?.classList.contains('meme-media__canvas--fluid')).toBe(
      false,
    );
  });

  it('stays fluid when the decoded frame is narrower than the stored width', async () => {
    frameWidth = 320;
    frameHeight = 160;
    render(<MemeImage media={imageMedia()} />);
    await takeOver();

    const canvas = document.querySelector('canvas') as HTMLCanvasElement;
    expect(canvas.classList.contains('meme-media__canvas--fluid')).toBe(true);
    expect(canvas.getAttribute('width')).toBe('320');
    expect(canvas.getAttribute('height')).toBe('160');
  });
});

describe('MemeImage permalink wrapper', () => {
  beforeEach(() => {
    vi.stubGlobal('ImageDecoder', FakeImageDecoder);
  });

  it('keeps the canvas inside the same permalink link the img had', async () => {
    render(<MemeImage media={imageMedia()} linkTo="/posts/abc1234567" />, {
      wrapper: MemoryRouter,
    });
    await takeOver();

    const link = screen.getByRole('link', { name: 'Funny cat' });
    expect(link.className).toBe('meme-media__link');
    expect(link.getAttribute('href')).toBe('/posts/abc1234567');
    expect(link.getAttribute('tabindex')).toBe('-1');
    expect(link.querySelector('canvas')).not.toBeNull();
  });
});
