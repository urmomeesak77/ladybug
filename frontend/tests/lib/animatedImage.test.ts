// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AnimatedImage } from '../../src/lib/animatedImage';

type TrackStub = { animated: boolean; frameCount: number; repetitionCount: number };
type FrameStub = { format: string | null; close: ReturnType<typeof vi.fn> };

// jsdom ships no ImageDecoder, so the whole API is faked here (research R11). Configuration
// is static rather than constructor-injected because the class is installed as a global and
// the code under test constructs it itself.
class FakeImageDecoder {
  static track: TrackStub | null = { animated: true, frameCount: 4, repetitionCount: Infinity };
  static supportsType = true;
  static throwsOnConstruct = false;
  // Firefox hands the SAME cached VideoFrame back for a frame index it has already decoded;
  // Chrome mints a fresh one every time. Both are modelled here because the difference is
  // what AnimatedImage has to discover.
  static sharesFrames = false;
  static throwsOnDecode = false;
  static instances: FakeImageDecoder[] = [];
  static isTypeSupported = vi.fn(() => Promise.resolve(FakeImageDecoder.supportsType));

  tracks: { ready: Promise<void>; selectedTrack: TrackStub | null };
  completed = Promise.resolve();
  close = vi.fn();
  type: string;
  frames: FrameStub[] = [];
  private cached = new Map<number, FrameStub>();

  constructor(init: { data: BufferSource; type: string }) {
    if (FakeImageDecoder.throwsOnConstruct) {
      throw new TypeError('unsupported');
    }
    this.type = init.type;
    this.tracks = { ready: Promise.resolve(), selectedTrack: FakeImageDecoder.track };
    FakeImageDecoder.instances.push(this);
  }

  decode(options: { frameIndex: number }): Promise<{ image: FrameStub }> {
    if (FakeImageDecoder.throwsOnDecode) {
      return Promise.reject(new DOMException('closed'));
    }
    const cached = this.cached.get(options.frameIndex);
    if (FakeImageDecoder.sharesFrames && cached) {
      return Promise.resolve({ image: cached });
    }
    const image: FrameStub = { format: 'BGRA', close: vi.fn() };
    this.cached.set(options.frameIndex, image);
    this.frames.push(image);
    return Promise.resolve({ image });
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
  FakeImageDecoder.sharesFrames = false;
  FakeImageDecoder.throwsOnDecode = false;
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

  // Who owns a decoded frame is a browser trait we cannot look up, and guessing it wrong is
  // fatal either way round: closing a frame the decoder still owns blanks the post (Firefox),
  // not closing one it handed us leaks it (Chrome). Hence a real probe, not a UA sniff.
  it('reports frames as owned when the decoder mints a new one per decode', async () => {
    stubImageDecoder();
    stubFetch('image/gif');

    const result = await AnimatedImage.probe('/storage/a/b/meme.gif');

    expect(result?.framesAreShared).toBe(false);
    // Both probe frames are ours, so both are released rather than left to the collector.
    const [decoder] = FakeImageDecoder.instances;
    expect(decoder.frames).toHaveLength(2);
    for (const frame of decoder.frames) {
      expect(frame.close).toHaveBeenCalledTimes(1);
    }
  });

  it('reports frames as shared when the decoder hands the same one back, closing neither', async () => {
    stubImageDecoder();
    stubFetch('image/gif');
    FakeImageDecoder.sharesFrames = true;

    const result = await AnimatedImage.probe('/storage/a/b/meme.gif');

    expect(result?.framesAreShared).toBe(true);
    const [decoder] = FakeImageDecoder.instances;
    expect(decoder.frames).toHaveLength(1);
    expect(decoder.frames[0].close).not.toHaveBeenCalled();
  });

  it('assumes shared frames when the ownership probe itself fails', async () => {
    stubImageDecoder();
    stubFetch('image/gif');
    FakeImageDecoder.throwsOnDecode = true;

    const result = await AnimatedImage.probe('/storage/a/b/meme.gif');

    expect(result?.framesAreShared).toBe(true);
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
