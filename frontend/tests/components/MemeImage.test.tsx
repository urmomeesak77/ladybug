// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import MemeImage from '../../src/components/MemeImage';
import type { ImageFeedMedia } from '../../src/components/MemeMedia';
import { AnimationRegistry } from '../../src/lib/animationRegistry';

const SELECTED_SRC = '/storage/meme-640.gif';

let currentSrc = SELECTED_SRC;
let trackAnimated = true;
let trackFrameCount = 4;
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
    selectedTrack: {
      animated: trackAnimated,
      frameCount: trackFrameCount,
      repetitionCount: Infinity,
    },
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
  trackFrameCount = 4;
  frameWidth = 640;
  frameHeight = 480;
  MockIntersectionObserver.instances = [];
  AnimationRegistry.reset();
  // The served type follows the URL so a .webp post is probed as image/webp, which is what
  // AnimatedImage.probe checks — a fixed image/gif header would make every WebP case pass
  // for the wrong reason.
  fetchMock = vi.fn((url: string) =>
    Promise.resolve(
      new Response(new ArrayBuffer(8), {
        headers: { 'Content-Type': url.endsWith('.webp') ? 'image/webp' : 'image/gif' },
      }),
    ),
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

  // The whole of the layout-shift defence. The <img>'s width attribute is a presentational
  // hint, so it lays out at exactly media.width px — measured in Chrome against this very
  // feed: a 500px post renders 500px, an 800px post 800px, never the column width. The
  // canvas must be handed that same number or the swap resizes the post.
  it('gives the canvas the media width so the swap changes no layout', async () => {
    render(<MemeImage media={imageMedia()} />);
    await takeOver();

    const canvas = document.querySelector('canvas') as HTMLCanvasElement;
    expect(canvas.style.getPropertyValue('--meme-media-width')).toBe('800px');
  });

  // Regression guard for the bug this replaced: width:100% blew a 120px GIF up to the full
  // 1246px column, breaking theme.css's explicit "never upscale" rule and shifting the
  // layout on takeover — the opposite of FR-009/SC-003.
  it('never stretches the canvas to the column width', async () => {
    render(<MemeImage media={imageMedia({ width: 120, height: 120 })} />);
    await takeOver();

    const canvas = document.querySelector('canvas') as HTMLCanvasElement;
    expect(canvas.style.getPropertyValue('--meme-media-width')).toBe('120px');
    expect(canvas.className).not.toContain('fluid');
    expect(canvas.style.width).not.toBe('100%');
  });

  it('sizes from the media, not the srcset, when there is no srcset', async () => {
    render(<MemeImage media={imageMedia({ srcset: '' })} />);
    await takeOver();

    const canvas = document.querySelector('canvas') as HTMLCanvasElement;
    expect(canvas.style.getPropertyValue('--meme-media-width')).toBe('800px');
  });

  // The small-variant case: the backing store follows the DECODED frame while the rendered
  // width stays the post's own, so a 320w variant does not shrink an 800px post.
  it('keeps the rendered width when the decoded frame is narrower than the stored width', async () => {
    frameWidth = 320;
    frameHeight = 160;
    render(<MemeImage media={imageMedia()} />);
    await takeOver();

    const canvas = document.querySelector('canvas') as HTMLCanvasElement;
    expect(canvas.style.getPropertyValue('--meme-media-width')).toBe('800px');
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

// FR-008 / SC-007: a post that is not an animated GIF or WebP must be exactly as cheap and
// exactly as static as it was before 021. "Cheap" is asserted as well as "static", because a
// 200-entry feed of JPEGs paying for two 51-threshold observers each is the regression a
// fetch-count assertion alone would miss (research R5).
describe('MemeImage leaves static images alone', () => {
  beforeEach(() => {
    vi.stubGlobal('ImageDecoder', FakeImageDecoder);
  });

  it('never observes or fetches a JPEG post', async () => {
    currentSrc = '/storage/meme-640.jpg';
    const { container } = render(<MemeImage media={imageMedia({ src: '/storage/meme.jpg' })} />);
    await settle();

    expect(container.querySelector('img')).not.toBeNull();
    expect(container.querySelector('canvas')).toBeNull();
    expect(MockIntersectionObserver.instances).toHaveLength(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('never observes or fetches a PNG post', async () => {
    currentSrc = '/storage/meme-640.png';
    const { container } = render(<MemeImage media={imageMedia({ src: '/storage/meme.png' })} />);
    await settle();

    expect(container.querySelector('img')).not.toBeNull();
    expect(container.querySelector('canvas')).toBeNull();
    expect(MockIntersectionObserver.instances).toHaveLength(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('probes a single-frame GIF once and leaves it an <img> forever', async () => {
    trackFrameCount = 1;
    const { container } = render(<MemeImage media={imageMedia()} />);
    await takeOver();

    expect(container.querySelector('img')?.className).toBe('meme-media meme-media__image');
    expect(container.querySelector('canvas')).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Scrolling past it again must not re-open the question: the answer is remembered for
    // the life of the page, so a still GIF costs one request ever.
    await takeOver();
    await fireVisible(true);

    expect(container.querySelector('canvas')).toBeNull();
    expect(container.querySelector('img')?.hasAttribute('data-playing')).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('probes a single-frame WebP once and leaves it an <img> forever', async () => {
    trackFrameCount = 1;
    currentSrc = '/storage/meme-640.webp';
    const { container } = render(
      <MemeImage
        media={imageMedia({
          src: '/storage/meme.webp',
          srcset: '/storage/meme-640.webp 640w, /storage/meme-320.webp 320w',
        })}
      />,
    );
    await takeOver();

    expect(container.querySelector('img')).not.toBeNull();
    expect(container.querySelector('canvas')).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('/storage/meme-640.webp', { cache: 'force-cache' });

    await takeOver();
    await fireVisible(true);

    expect(container.querySelector('canvas')).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

// FR-009 / FR-010: everything the visitor can do with the post has to survive the element
// swap — the permalink click target, the text alternative, and the rendered box.
describe('MemeImage preserves the post around the swap', () => {
  beforeEach(() => {
    vi.stubGlobal('ImageDecoder', FakeImageDecoder);
  });

  it('still navigates to the permalink when the canvas is clicked', async () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route
            path="/"
            element={<MemeImage media={imageMedia()} linkTo="/posts/abc1234567" />}
          />
          <Route path="/posts/:hash" element={<p>Permalink page</p>} />
        </Routes>
      </MemoryRouter>,
    );
    await takeOver();
    expect(document.querySelector('canvas')).not.toBeNull();

    fireEvent.click(screen.getByRole('link', { name: 'Funny cat' }));

    expect(screen.getByText('Permalink page')).toBeTruthy();
  });

  it('carries the img alt across to the canvas as its accessible name', async () => {
    render(<MemeImage media={imageMedia()} />);
    const alt = screen.getByRole('img', { name: 'Funny cat' }).getAttribute('alt');
    await takeOver();

    const canvas = document.querySelector('canvas') as HTMLCanvasElement;
    expect(canvas.getAttribute('role')).toBe('img');
    expect(canvas.getAttribute('aria-label')).toBe(alt);
    expect(screen.getByRole('img', { name: 'Funny cat' })).toBe(canvas);
  });

  it('keeps the rendered box at the same aspect ratio in both states', async () => {
    // The small-variant case: the decoded frame is half the stored size, so the canvas
    // attributes alone would shrink the post. --meme-media-width restores the width the
    // <img> laid out at and the frame's own ratio keeps the height honest.
    frameWidth = 320;
    frameHeight = 160;
    render(<MemeImage media={imageMedia()} />);
    const img = screen.getByRole('img', { name: 'Funny cat' });
    const imageRatio = Number(img.getAttribute('width')) / Number(img.getAttribute('height'));
    await takeOver();

    const canvas = document.querySelector('canvas') as HTMLCanvasElement;
    expect(canvas.width).toBe(320);
    expect(canvas.height).toBe(160);
    expect(canvas.width / canvas.height).toBe(imageRatio);
    expect(canvas.style.getPropertyValue('--meme-media-width')).toBe(`${img.getAttribute('width')}px`);
  });
});
