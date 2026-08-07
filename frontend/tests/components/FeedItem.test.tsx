// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import FeedItem from '../../src/components/FeedItem';
import NoticeProvider from '../../src/components/NoticeProvider';
import { AnimationRegistry } from '../../src/lib/animationRegistry';
import { ModerationApi } from '../../src/lib/moderationApi';
import type { FeedMedia, FeedPost } from '../../src/lib/feedModel';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function post(overrides: Partial<FeedPost> = {}): FeedPost {
  return {
    hash: 'abc1234567',
    title: 'Funny cat',
    permalink: '/posts/abc1234567',
    media: { kind: 'none' },
    hidden: null,
    author: 'alice',
    createdAt: '2026-07-22T12:00:00',
    commentCount: 0,
    ...overrides,
  };
}

describe('FeedItem', () => {
  it('links the title to the post permalink', () => {
    render(<FeedItem post={post()} />, { wrapper: MemoryRouter });

    const link = screen.getByRole('link', { name: 'Funny cat' });
    expect(link.getAttribute('href')).toBe('/posts/abc1234567');
  });

  it('links the image to the post permalink as well', () => {
    const media = {
      kind: 'image' as const,
      src: '/img/800/a/abc.jpg',
      srcset: '',
      sizes: '',
      alt: 'Funny cat pic',
      width: 800,
      height: 400,
    };
    render(<FeedItem post={post({ media })} />, { wrapper: MemoryRouter });

    const link = screen.getByRole('link', { name: 'Funny cat pic' });
    expect(link.getAttribute('href')).toBe('/posts/abc1234567');
  });

  it('falls back to a generic title for untitled posts', () => {
    render(<FeedItem post={post({ title: null })} />, { wrapper: MemoryRouter });

    expect(screen.getByRole('link', { name: 'Untitled meme' })).toBeTruthy();
  });

  it('shows the uploader byline below the media', () => {
    render(<FeedItem post={post()} />, { wrapper: MemoryRouter });

    expect(screen.getByText(/by alice/i)).toBeTruthy();
    expect(screen.getByText(/2026-07-22/)).toBeTruthy();
  });

  it('shows no admin actions by default', () => {
    render(<FeedItem post={post()} />, { wrapper: MemoryRouter });

    expect(screen.queryByRole('button', { name: /more actions/i })).toBeNull();
  });

  it('shows the admin actions kebab when canModerate', () => {
    render(
      <NoticeProvider>
        <MemoryRouter>
          <FeedItem post={post()} canModerate onRemove={() => {}} />
        </MemoryRouter>
      </NoticeProvider>,
    );

    expect(screen.getByRole('button', { name: /more actions for funny cat/i })).toBeTruthy();
  });

  it('removes the item after a successful deactivate', async () => {
    const onRemove = vi.fn();
    vi.spyOn(ModerationApi, 'deactivate').mockResolvedValue({
      ok: true,
      row: {
        hash: 'abc1234567', thumbnail: null, title: null, type: null,
        username: null, createdAt: null, activatedAt: null, deletedAt: null,
      },
    });
    render(
      <NoticeProvider>
        <MemoryRouter>
          <FeedItem post={post()} canModerate onRemove={onRemove} />
        </MemoryRouter>
      </NoticeProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: /more actions/i }));
    fireEvent.click(screen.getByRole('menuitem', { name: /^deactivate$/i }));

    await waitFor(() => expect(onRemove).toHaveBeenCalledWith('abc1234567'));
  });

  it('keeps the item when an action leaves the meme public', async () => {
    const onRemove = vi.fn();
    // Defensive: if an action returns a still-public row (hidden null), the feed keeps it —
    // dropping it would hide a meme that is still visible to everyone.
    vi.spyOn(ModerationApi, 'deactivate').mockResolvedValue({
      ok: true,
      row: {
        hash: 'abc1234567', thumbnail: null, title: null, type: null,
        username: null, createdAt: null, activatedAt: '2026-07-09 08:00:00', deletedAt: null,
      },
    });
    render(
      <NoticeProvider>
        <MemoryRouter>
          <FeedItem post={post()} canModerate onRemove={onRemove} />
        </MemoryRouter>
      </NoticeProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: /more actions/i }));
    fireEvent.click(screen.getByRole('menuitem', { name: /^deactivate$/i }));

    await waitFor(() => expect(ModerationApi.deactivate).toHaveBeenCalled());
    expect(onRemove).not.toHaveBeenCalled();
  });
});

// The real feed path, end to end: a feed entry whose media is animated must reach the 021
// takeover through FeedItem → MemeMedia → MemeImage, and the entries around it must be
// entirely unaffected — FR-005's "wherever these memes are shown", feed half.
describe('FeedItem animated media', () => {
  const ANIMATED_SRC = '/storage/dance.gif';

  let fetchMock: ReturnType<typeof vi.fn>;
  // The variant the <img> would have selected, plus the type the server would serve it as.
  let selectedSrc = ANIMATED_SRC;
  let selectedType = 'image/gif';

  class FakeImageDecoder {
    static isTypeSupported = vi.fn(() => Promise.resolve(true));

    tracks = {
      ready: Promise.resolve(),
      selectedTrack: { animated: true, frameCount: 4, repetitionCount: Infinity },
    };
    completed = Promise.resolve();
    close = vi.fn();
    decode = vi.fn(() =>
      Promise.resolve({
        image: { displayWidth: 320, displayHeight: 240, duration: 40_000, close: vi.fn() },
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
            intersectionRect: { height: isIntersecting ? 240 : 0 } as DOMRectReadOnly,
            rootBounds: { height: 800 } as DOMRectReadOnly,
          } as IntersectionObserverEntry,
        ],
        this as unknown as IntersectionObserver,
      );
    }
  }

  function media(src: string): FeedMedia {
    return { kind: 'image', src, srcset: '', sizes: '', alt: `Pic ${src}`, width: 320, height: 240 };
  }

  async function settle(): Promise<void> {
    await act(async () => {
      for (let turn = 0; turn < 20; turn += 1) {
        await Promise.resolve();
      }
    });
  }

  beforeEach(() => {
    MockIntersectionObserver.instances = [];
    selectedSrc = ANIMATED_SRC;
    selectedType = 'image/gif';
    AnimationRegistry.reset();
    fetchMock = vi.fn(() =>
      Promise.resolve(
        new Response(new ArrayBuffer(8), { headers: { 'Content-Type': selectedType } }),
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('ImageDecoder', FakeImageDecoder);
    vi.stubGlobal('IntersectionObserver', MockIntersectionObserver);
    Object.defineProperty(HTMLImageElement.prototype, 'currentSrc', {
      configurable: true,
      get: () => selectedSrc,
    });
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      clearRect: vi.fn(),
      drawImage: vi.fn(),
    } as unknown as CanvasRenderingContext2D);
  });

  afterEach(() => {
    AnimationRegistry.reset();
    vi.unstubAllGlobals();
  });

  it('takes over an animated entry and leaves its neighbours untouched', async () => {
    const { container } = render(
      <MemoryRouter>
        <FeedItem post={post({ hash: 'sta1111111', media: media('/storage/still.jpg') })} />
        <FeedItem post={post({ hash: 'gif2222222', media: media(ANIMATED_SRC) })} />
        <FeedItem post={post({ hash: 'sta3333333', media: media('/storage/other.png') })} />
      </MemoryRouter>,
    );

    // Only the animated entry is eligible, so it is the only one that is observed at all —
    // the two static neighbours construct no IntersectionObserver (FR-008, research R5).
    expect(MockIntersectionObserver.instances).toHaveLength(2);

    act(() => MockIntersectionObserver.instances[1].fire(true));
    await settle();

    const canvases = container.querySelectorAll('canvas');
    expect(canvases).toHaveLength(1);
    expect(canvases[0].classList.contains('meme-media__canvas')).toBe(true);
    expect(canvases[0].getAttribute('aria-label')).toBe(`Pic ${ANIMATED_SRC}`);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(ANIMATED_SRC, { cache: 'force-cache' });

    const stillImages = container.querySelectorAll('img');
    expect(stillImages).toHaveLength(2);
    expect(stillImages[0].getAttribute('src')).toBe('/storage/still.jpg');
    expect(stillImages[1].getAttribute('src')).toBe('/storage/other.png');
  });

  it('renders an animated WebP entry through the same path', async () => {
    selectedSrc = '/storage/dance.webp';
    selectedType = 'image/webp';
    const { container } = render(
      <MemoryRouter>
        <FeedItem post={post({ media: media(selectedSrc) })} />
      </MemoryRouter>,
    );

    act(() => MockIntersectionObserver.instances[1].fire(true));
    await settle();

    expect(container.querySelector('canvas.meme-media__canvas')).not.toBeNull();
  });
});
