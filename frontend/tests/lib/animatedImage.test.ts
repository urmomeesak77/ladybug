// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AnimatedImage } from '../../src/lib/animatedImage';

type TrackStub = { animated: boolean; frameCount: number; repetitionCount: number };

// jsdom ships no ImageDecoder, so the whole API is faked here (research R11). Configuration
// is static rather than constructor-injected because the class is installed as a global and
// the code under test constructs it itself.
class FakeImageDecoder {
  static track: TrackStub | null = { animated: true, frameCount: 4, repetitionCount: Infinity };
  static supportsType = true;
  static throwsOnConstruct = false;
  static instances: FakeImageDecoder[] = [];
  static isTypeSupported = vi.fn(() => Promise.resolve(FakeImageDecoder.supportsType));

  tracks: { ready: Promise<void>; selectedTrack: TrackStub | null };
  completed = Promise.resolve();
  close = vi.fn();
  type: string;

  constructor(init: { data: BufferSource; type: string }) {
    if (FakeImageDecoder.throwsOnConstruct) {
      throw new TypeError('unsupported');
    }
    this.type = init.type;
    this.tracks = { ready: Promise.resolve(), selectedTrack: FakeImageDecoder.track };
    FakeImageDecoder.instances.push(this);
  }
}

function stubImageDecoder(): void {
  vi.stubGlobal('ImageDecoder', FakeImageDecoder);
}

function stubFetch(contentType: string, status = 200): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(() =>
    Promise.resolve(
      new Response(new ArrayBuffer(8), { status, headers: { 'Content-Type': contentType } }),
    ),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

beforeEach(() => {
  FakeImageDecoder.track = { animated: true, frameCount: 4, repetitionCount: Infinity };
  FakeImageDecoder.supportsType = true;
  FakeImageDecoder.throwsOnConstruct = false;
  FakeImageDecoder.instances = [];
  FakeImageDecoder.isTypeSupported.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('AnimatedImage.isSupported', () => {
  it('reports no support when the browser has no ImageDecoder', () => {
    expect(AnimatedImage.isSupported()).toBe(false);
  });

  it('reports support once ImageDecoder exists', () => {
    stubImageDecoder();

    expect(AnimatedImage.isSupported()).toBe(true);
  });
});

describe('AnimatedImage.isCandidate', () => {
  it('accepts gif and webp URLs, including with a query string', () => {
    expect(AnimatedImage.isCandidate('/storage/a/b/meme.gif')).toBe(true);
    expect(AnimatedImage.isCandidate('/storage/a/b/meme.webp')).toBe(true);
    expect(AnimatedImage.isCandidate('/storage/a/b/meme.gif?v=2')).toBe(true);
    expect(AnimatedImage.isCandidate('/storage/a/b/MEME.WEBP')).toBe(true);
  });

  it('rejects formats that can never be animated', () => {
    expect(AnimatedImage.isCandidate('/storage/a/b/meme.jpg')).toBe(false);
    expect(AnimatedImage.isCandidate('/storage/a/b/meme.png')).toBe(false);
    expect(AnimatedImage.isCandidate('/storage/a/b/meme.mp4')).toBe(false);
    expect(AnimatedImage.isCandidate('')).toBe(false);
  });
});

describe('AnimatedImage.probe', () => {
  it('resolves null and never fetches without ImageDecoder support', async () => {
    const fetchMock = stubFetch('image/gif');

    await expect(AnimatedImage.probe('/storage/a/b/meme.gif')).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('resolves null and never fetches for a non-candidate URL', async () => {
    stubImageDecoder();
    const fetchMock = stubFetch('image/jpeg');

    await expect(AnimatedImage.probe('/storage/a/b/meme.jpg')).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fetches the already-loaded bytes from the HTTP cache', async () => {
    stubImageDecoder();
    const fetchMock = stubFetch('image/gif');

    await AnimatedImage.probe('/storage/a/b/meme.gif');

    expect(fetchMock).toHaveBeenCalledWith('/storage/a/b/meme.gif', { cache: 'force-cache' });
  });

  it('reports the track facts for a multi-frame image', async () => {
    stubImageDecoder();
    stubFetch('image/gif');

    const result = await AnimatedImage.probe('/storage/a/b/meme.gif');

    expect(result).not.toBeNull();
    expect(result?.frameCount).toBe(4);
    expect(result?.repetitionCount).toBe(Infinity);
    expect(result?.decoder).toBe(FakeImageDecoder.instances[0]);
  });

  it('resolves null when the response is not a gif or webp', async () => {
    stubImageDecoder();
    stubFetch('text/html');

    await expect(AnimatedImage.probe('/storage/a/b/meme.gif')).resolves.toBeNull();
    expect(FakeImageDecoder.instances).toHaveLength(0);
  });

  it('resolves null when the response status is not ok', async () => {
    stubImageDecoder();
    stubFetch('image/gif', 404);

    await expect(AnimatedImage.probe('/storage/a/b/meme.gif')).resolves.toBeNull();
    expect(FakeImageDecoder.instances).toHaveLength(0);
  });

  it('resolves null when the decoder cannot handle the type', async () => {
    stubImageDecoder();
    stubFetch('image/webp');
    FakeImageDecoder.supportsType = false;

    await expect(AnimatedImage.probe('/storage/a/b/meme.webp')).resolves.toBeNull();
    expect(FakeImageDecoder.instances).toHaveLength(0);
  });

  it('resolves null and closes the decoder for a still image', async () => {
    stubImageDecoder();
    stubFetch('image/webp');
    FakeImageDecoder.track = { animated: false, frameCount: 1, repetitionCount: 0 };

    await expect(AnimatedImage.probe('/storage/a/b/meme.webp')).resolves.toBeNull();
    expect(FakeImageDecoder.instances[0].close).toHaveBeenCalledTimes(1);
  });

  it('resolves null for an animated track carrying a single frame', async () => {
    stubImageDecoder();
    stubFetch('image/gif');
    FakeImageDecoder.track = { animated: true, frameCount: 1, repetitionCount: 0 };

    await expect(AnimatedImage.probe('/storage/a/b/meme.gif')).resolves.toBeNull();
    expect(FakeImageDecoder.instances[0].close).toHaveBeenCalledTimes(1);
  });

  it('resolves null when there is no selected track', async () => {
    stubImageDecoder();
    stubFetch('image/gif');
    FakeImageDecoder.track = null;

    await expect(AnimatedImage.probe('/storage/a/b/meme.gif')).resolves.toBeNull();
  });

  it('resolves null when the fetch rejects', async () => {
    stubImageDecoder();
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('offline'))));

    await expect(AnimatedImage.probe('/storage/a/b/meme.gif')).resolves.toBeNull();
  });

  it('resolves null when constructing the decoder throws', async () => {
    stubImageDecoder();
    stubFetch('image/gif');
    FakeImageDecoder.throwsOnConstruct = true;

    await expect(AnimatedImage.probe('/storage/a/b/meme.gif')).resolves.toBeNull();
  });
});

describe('AnimatedImage.frameDelayMs', () => {
  it('converts the frame duration from microseconds to milliseconds', () => {
    expect(AnimatedImage.frameDelayMs(100_000)).toBe(100);
    expect(AnimatedImage.frameDelayMs(41_000)).toBe(41);
    expect(AnimatedImage.frameDelayMs(20_000)).toBe(20);
  });

  it('falls back to 100 ms for missing, absurd or "as fast as possible" durations', () => {
    expect(AnimatedImage.frameDelayMs(null)).toBe(100);
    expect(AnimatedImage.frameDelayMs(Number.NaN)).toBe(100);
    expect(AnimatedImage.frameDelayMs(Infinity)).toBe(100);
    expect(AnimatedImage.frameDelayMs(0)).toBe(100);
    expect(AnimatedImage.frameDelayMs(10_000)).toBe(100);
  });
});
