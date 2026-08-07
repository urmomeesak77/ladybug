// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AnimatedImage } from '../../src/lib/animatedImage';
import { AnimationRegistry } from '../../src/lib/animationRegistry';
import type { PlaybackSession } from '../../src/lib/animationRegistry';

// The decoders handed out by the stubbed probe, so a test can assert close() on the exact
// session that was evicted.
const decoded = new Map<string, PlaybackSession>();

function url(index: number): string {
  return `/storage/meme-${index}.gif`;
}

let sharesFrames = false;

function fakeSession(forUrl: string): PlaybackSession {
  const session = {
    decoder: { close: vi.fn() } as unknown as ImageDecoder,
    frameCount: 4,
    repetitionCount: Infinity,
    framesAreShared: sharesFrames,
  };
  decoded.set(forUrl, session);
  return session;
}

function fakeFrame(): { frame: VideoFrame; close: ReturnType<typeof vi.fn> } {
  const close = vi.fn();
  return { frame: { close } as unknown as VideoFrame, close };
}

function stubProbe(): ReturnType<typeof vi.spyOn> {
  return vi.spyOn(AnimatedImage, 'probe').mockImplementation((probed: string) =>
    Promise.resolve(fakeSession(probed)),
  );
}

function closeSpy(forUrl: string): ReturnType<typeof vi.fn> {
  return decoded.get(forUrl)?.decoder.close as unknown as ReturnType<typeof vi.fn>;
}

async function acquireRange(from: number, to: number): Promise<void> {
  for (let index = from; index < to; index += 1) {
    await AnimationRegistry.acquire(url(index));
  }
}

function liveCount(count: number): number {
  let live = 0;
  for (let index = 0; index < count; index += 1) {
    if (AnimationRegistry.peek(url(index))) {
      live += 1;
    }
  }
  return live;
}

beforeEach(() => {
  decoded.clear();
  sharesFrames = false;
  AnimationRegistry.reset();
});

afterEach(() => {
  AnimationRegistry.reset();
  vi.restoreAllMocks();
});

describe('AnimationRegistry positions', () => {
  it('reads an unseen URL as frame 0 and allocates nothing', () => {
    const probe = stubProbe();

    expect(AnimationRegistry.position(url(0))).toEqual({
      frameIndex: 0,
      loopsDone: 0,
      isFinished: false,
    });
    expect(AnimationRegistry.peek(url(0))).toBeNull();
    expect(probe).not.toHaveBeenCalled();
  });

  it('round-trips a saved position', () => {
    AnimationRegistry.savePosition(url(0), { frameIndex: 7, loopsDone: 2, isFinished: true });

    expect(AnimationRegistry.position(url(0))).toEqual({
      frameIndex: 7,
      loopsDone: 2,
      isFinished: true,
    });
  });
});

describe('AnimationRegistry acquisition', () => {
  it('decodes once and serves the cached session afterwards', async () => {
    const probe = stubProbe();

    const first = await AnimationRegistry.acquire(url(0));
    const second = await AnimationRegistry.acquire(url(0));

    expect(probe).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
  });

  it('shares one in-flight decode between overlapping acquisitions', async () => {
    const probe = stubProbe();

    const [first, second] = await Promise.all([
      AnimationRegistry.acquire(url(0)),
      AnimationRegistry.acquire(url(0)),
    ]);

    expect(probe).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
  });

  it('resolves null and holds nothing when the probe finds no animation', async () => {
    vi.spyOn(AnimatedImage, 'probe').mockResolvedValue(null);

    await expect(AnimationRegistry.acquire(url(0))).resolves.toBeNull();
    expect(AnimationRegistry.peek(url(0))).toBeNull();
  });
});

describe('AnimationRegistry eviction', () => {
  it('holds at most twelve sessions however deep the scroll goes', async () => {
    stubProbe();

    await acquireRange(0, 20);

    expect(liveCount(20)).toBe(12);
  });

  it('evicts the least-recently-used session on the thirteenth acquire, closing it once', async () => {
    stubProbe();

    await acquireRange(0, 12);
    await AnimationRegistry.acquire(url(12));

    expect(AnimationRegistry.peek(url(0))).toBeNull();
    expect(closeSpy(url(0))).toHaveBeenCalledTimes(1);
    expect(AnimationRegistry.peek(url(1))).not.toBeNull();
  });

  it('counts a re-acquire as use, so the touched session survives', async () => {
    stubProbe();

    await acquireRange(0, 12);
    await AnimationRegistry.acquire(url(0));
    await AnimationRegistry.acquire(url(12));

    expect(AnimationRegistry.peek(url(0))).not.toBeNull();
    expect(AnimationRegistry.peek(url(1))).toBeNull();
  });

  it('does not re-create an evicted session on peek', async () => {
    const probe = stubProbe();

    await acquireRange(0, 13);
    probe.mockClear();

    expect(AnimationRegistry.peek(url(0))).toBeNull();
    expect(probe).not.toHaveBeenCalled();
  });

  it('rebuilds an evicted session on re-acquire and leaves its remembered frame alone', async () => {
    stubProbe();
    AnimationRegistry.savePosition(url(0), { frameIndex: 5, loopsDone: 1, isFinished: false });

    await acquireRange(0, 13);
    const rebuilt = await AnimationRegistry.acquire(url(0));

    expect(rebuilt).not.toBeNull();
    expect(AnimationRegistry.position(url(0))).toEqual({
      frameIndex: 5,
      loopsDone: 1,
      isFinished: false,
    });
  });
});

describe('AnimationRegistry pinning', () => {
  it('keeps a pinned session even when it is the least recently used of all', async () => {
    stubProbe();

    await acquireRange(0, 12);
    AnimationRegistry.pin(url(0));
    await AnimationRegistry.acquire(url(12));

    expect(AnimationRegistry.peek(url(0))).not.toBeNull();
    expect(AnimationRegistry.peek(url(1))).toBeNull();
  });

  it('still respects the cap when every session is pinned', async () => {
    stubProbe();

    await acquireRange(0, 12);
    for (let index = 0; index < 12; index += 1) {
      AnimationRegistry.pin(url(index));
    }
    await AnimationRegistry.acquire(url(12));

    expect(liveCount(13)).toBe(12);
    expect(AnimationRegistry.peek(url(0))).toBeNull();
  });

  it('returns a session to the eviction pool once it is unpinned', async () => {
    stubProbe();

    await acquireRange(0, 12);
    AnimationRegistry.pin(url(0));
    AnimationRegistry.unpin(url(0));
    await AnimationRegistry.acquire(url(12));

    expect(AnimationRegistry.peek(url(0))).toBeNull();
  });

  it('ignores unpinning a URL it has never seen', () => {
    expect(() => AnimationRegistry.unpin('/storage/unknown.gif')).not.toThrow();
  });
});

describe('AnimationRegistry.reset', () => {
  it('closes every live decoder and forgets positions and pins', async () => {
    stubProbe();
    await acquireRange(0, 3);
    AnimationRegistry.pin(url(0));
    AnimationRegistry.savePosition(url(0), { frameIndex: 3, loopsDone: 0, isFinished: false });

    AnimationRegistry.reset();

    expect(closeSpy(url(0))).toHaveBeenCalledTimes(1);
    expect(closeSpy(url(2))).toHaveBeenCalledTimes(1);
    expect(AnimationRegistry.peek(url(0))).toBeNull();
    expect(AnimationRegistry.position(url(0)).frameIndex).toBe(0);
  });
});

// Whether a drawn frame may be closed is a property of the decoder that produced it, so the
// registry — the only thing that knows which session a URL is on — answers it.
describe('AnimationRegistry.release', () => {
  it('closes a frame the decoder minted for us', async () => {
    stubProbe();
    await AnimationRegistry.acquire(url(0));
    const { frame, close } = fakeFrame();

    AnimationRegistry.release(url(0), frame);

    expect(close).toHaveBeenCalledTimes(1);
  });

  it('leaves a frame the decoder still owns alone', async () => {
    sharesFrames = true;
    stubProbe();
    await AnimationRegistry.acquire(url(0));
    const { frame, close } = fakeFrame();

    AnimationRegistry.release(url(0), frame);

    expect(close).not.toHaveBeenCalled();
  });

  // An evicted session's decoder is closed already, so nothing else can be holding its
  // frames: whatever is left over is ours to release.
  it('closes a frame whose session is gone', () => {
    const { frame, close } = fakeFrame();

    AnimationRegistry.release(url(0), frame);

    expect(close).toHaveBeenCalledTimes(1);
  });
});
