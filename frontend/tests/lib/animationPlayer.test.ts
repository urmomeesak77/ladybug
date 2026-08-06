// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AnimatedImage } from '../../src/lib/animatedImage';
import { AnimationPlayer } from '../../src/lib/animationPlayer';
import { AnimationRegistry } from '../../src/lib/animationRegistry';

const MEME_URL = '/storage/meme.gif';
const FRAME_DURATION_US = 40_000;
const FRAME_DELAY_MS = 40;

type FrameStub = { duration: number; close: ReturnType<typeof vi.fn> };

let frames: FrameStub[];
let decodedIndexes: number[];
let decode: ReturnType<typeof vi.fn>;
let context: { clearRect: ReturnType<typeof vi.fn>; drawImage: ReturnType<typeof vi.fn> };
let canvas: HTMLCanvasElement;

function makeFrame(): VideoFrame {
  const frame = { duration: FRAME_DURATION_US, close: vi.fn() };
  frames.push(frame);
  return frame as unknown as VideoFrame;
}

// A registry session backed by a decoder whose decode() records the frame indexes asked for.
// The registry itself is the real one — only the probe underneath it is stubbed.
function installSession(frameCount: number, repetitionCount: number): void {
  decode = vi.fn((options: { frameIndex: number }) => {
    decodedIndexes.push(options.frameIndex);
    return Promise.resolve({ image: makeFrame() });
  });
  vi.spyOn(AnimatedImage, 'probe').mockImplementation(() =>
    Promise.resolve({
      decoder: { close: vi.fn(), decode } as unknown as ImageDecoder,
      frameCount,
      repetitionCount,
    }),
  );
}

// The awaits inside a frame step (acquire → decode → draw) are microtasks, which fake
// timers do not flush on their own.
async function settle(): Promise<void> {
  for (let turn = 0; turn < 20; turn += 1) {
    await Promise.resolve();
  }
}

async function advance(ms: number): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms);
  await settle();
}

beforeEach(() => {
  vi.useFakeTimers();
  frames = [];
  decodedIndexes = [];
  AnimationRegistry.reset();
  context = { clearRect: vi.fn(), drawImage: vi.fn() };
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
    context as unknown as CanvasRenderingContext2D,
  );
  canvas = document.createElement('canvas');
});

afterEach(() => {
  AnimationRegistry.reset();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('AnimationPlayer playback', () => {
  it('draws the remembered frame first and paces the next one by the frame delay', async () => {
    installSession(4, Infinity);
    AnimationRegistry.savePosition(MEME_URL, { frameIndex: 2, loopsDone: 0, isFinished: false });
    const player = new AnimationPlayer(MEME_URL, canvas);

    player.start();
    await settle();

    expect(decodedIndexes[0]).toBe(2);
    expect(context.drawImage).toHaveBeenCalledTimes(1);

    await advance(FRAME_DELAY_MS - 1);
    expect(context.drawImage).toHaveBeenCalledTimes(1);

    await advance(1);
    expect(context.drawImage).toHaveBeenCalledTimes(2);
    expect(player.isPlaying).toBe(true);
  });

  it('clears the canvas before each frame so transparent frames do not stack', async () => {
    installSession(4, Infinity);
    const player = new AnimationPlayer(MEME_URL, canvas);

    player.start();
    await settle();

    expect(context.clearRect).toHaveBeenCalledTimes(1);
  });

  it('closes every decoded frame once it has been drawn', async () => {
    installSession(4, Infinity);
    const player = new AnimationPlayer(MEME_URL, canvas);

    player.start();
    await advance(FRAME_DELAY_MS * 3);
    player.stop();
    await settle();

    expect(frames.length).toBeGreaterThan(1);
    for (const frame of frames) {
      expect(frame.close).toHaveBeenCalledTimes(1);
    }
  });
});

describe('AnimationPlayer freeze and resume', () => {
  it('persists the frozen frame and decodes nothing more once stopped', async () => {
    installSession(4, Infinity);
    const player = new AnimationPlayer(MEME_URL, canvas);

    player.start();
    await settle();
    player.stop();
    decode.mockClear();
    await advance(FRAME_DELAY_MS * 5);

    expect(player.isPlaying).toBe(false);
    expect(decode).not.toHaveBeenCalled();
    expect(AnimationRegistry.position(MEME_URL)).toEqual({
      frameIndex: 0,
      loopsDone: 0,
      isFinished: false,
    });
  });

  it('resumes on the frozen frame over ten cycles without drifting', async () => {
    installSession(4, Infinity);
    const player = new AnimationPlayer(MEME_URL, canvas);
    let frozen = 0;

    for (let cycle = 0; cycle < 10; cycle += 1) {
      decodedIndexes = [];
      player.start();
      await settle();

      expect(decodedIndexes[0]).toBe(frozen);

      await advance(FRAME_DELAY_MS);
      player.stop();
      await settle();
      frozen = (frozen + 1) % 4;

      expect(AnimationRegistry.position(MEME_URL).frameIndex).toBe(frozen);
    }
  });

  it('ignores a repeated start and a repeated stop', async () => {
    installSession(4, Infinity);
    const unpin = vi.spyOn(AnimationRegistry, 'unpin');
    const player = new AnimationPlayer(MEME_URL, canvas);

    player.start();
    player.start();
    await settle();

    expect(decodedIndexes.filter((index) => index === 0)).toHaveLength(1);

    player.stop();
    player.stop();

    expect(unpin).toHaveBeenCalledTimes(1);
  });
});

describe('AnimationPlayer repeat allowance', () => {
  it('plays a play-once file exactly once and rests on its final frame', async () => {
    installSession(3, 0);
    const player = new AnimationPlayer(MEME_URL, canvas);

    player.start();
    await advance(FRAME_DELAY_MS * 10);

    expect(context.drawImage).toHaveBeenCalledTimes(3);
    expect(player.isPlaying).toBe(false);
    expect(AnimationRegistry.position(MEME_URL)).toEqual({
      frameIndex: 2,
      loopsDone: 1,
      isFinished: true,
    });
  });

  it('refuses to start again once the allowance is spent, holding no pin', async () => {
    installSession(3, 0);
    const unpin = vi.spyOn(AnimationRegistry, 'unpin');
    const player = new AnimationPlayer(MEME_URL, canvas);

    player.start();
    await advance(FRAME_DELAY_MS * 10);
    expect(unpin).toHaveBeenCalledTimes(1);

    decode.mockClear();
    player.start();
    await settle();

    expect(player.isPlaying).toBe(false);
    expect(decode).not.toHaveBeenCalled();
  });

  it('plays a file declaring two repetitions exactly three times', async () => {
    installSession(2, 2);
    const player = new AnimationPlayer(MEME_URL, canvas);

    player.start();
    await advance(FRAME_DELAY_MS * 20);

    expect(context.drawImage).toHaveBeenCalledTimes(6);
    expect(player.isPlaying).toBe(false);
  });

  it('keeps looping a file that repeats forever', async () => {
    installSession(2, Infinity);
    const player = new AnimationPlayer(MEME_URL, canvas);

    player.start();
    await advance(FRAME_DELAY_MS * 20);

    expect(context.drawImage).toHaveBeenCalledTimes(21);
    expect(player.isPlaying).toBe(true);
    player.stop();
  });
});

describe('AnimationPlayer pinning and recovery', () => {
  it('pins its URL while running and unpins it when stopped', async () => {
    installSession(4, Infinity);
    const pin = vi.spyOn(AnimationRegistry, 'pin');
    const unpin = vi.spyOn(AnimationRegistry, 'unpin');
    const player = new AnimationPlayer(MEME_URL, canvas);

    player.start();
    await settle();

    expect(pin).toHaveBeenCalledWith(MEME_URL);
    expect(unpin).not.toHaveBeenCalled();

    player.stop();

    expect(unpin).toHaveBeenCalledWith(MEME_URL);
  });

  it('re-acquires once and carries on when a decode rejects', async () => {
    installSession(4, Infinity);
    const acquire = vi.spyOn(AnimationRegistry, 'acquire');
    decode.mockRejectedValueOnce(new DOMException('closed'));
    const player = new AnimationPlayer(MEME_URL, canvas);

    player.start();
    await settle();

    expect(acquire.mock.calls.length).toBeGreaterThan(1);
    expect(context.drawImage).toHaveBeenCalledTimes(1);
    expect(player.isPlaying).toBe(true);
    player.stop();
  });

  it('stops on the frame it is showing when the retry fails too', async () => {
    installSession(4, Infinity);
    decode.mockRejectedValue(new DOMException('closed'));
    const player = new AnimationPlayer(MEME_URL, canvas);

    player.start();
    await settle();

    expect(player.isPlaying).toBe(false);
    expect(context.clearRect).not.toHaveBeenCalled();
    expect(context.drawImage).not.toHaveBeenCalled();
  });

  it('stops when the media turns out not to be animated after all', async () => {
    vi.spyOn(AnimatedImage, 'probe').mockResolvedValue(null);
    const player = new AnimationPlayer(MEME_URL, canvas);

    player.start();
    await settle();

    expect(player.isPlaying).toBe(false);
  });
});
