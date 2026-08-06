import { AnimatedImage } from './animatedImage';
import { AnimationRegistry } from './animationRegistry';

// The one INSTANCE class among lib/'s static-only modules (research R15): a player owns
// genuinely per-post mutable state — the frame it is showing, its timer handle and its loop
// count — which a static API could only fake with a keyed map. It is deliberate, not a slip.
//
// Stopping is simply "do not schedule the next frame", so the frame index it is holding IS
// the resume point (FR-003), and an off-screen post can neither cost anything nor spend a
// play-through (FR-002/FR-003a).

// Where playback goes next. Computed from the shown frame but NOT committed until that next
// frame is actually drawn, so a stop mid-flight always freezes on what the visitor can see.
type FramePlan = { index: number; loops: number; isFinished: boolean };

export class AnimationPlayer {
  private readonly url: string;
  private readonly canvas: HTMLCanvasElement;
  private readonly context: CanvasRenderingContext2D | null;
  private frameIndex = 0;
  private loopsDone = 0;
  private isFinished = false;
  private isRunning = false;
  private frameCount = 1;
  private repetitionCount = Infinity;
  private timer: number | null = null;
  private nextPlan: FramePlan | null = null;
  private pending: Promise<VideoFrame | null> | null = null;

  constructor(url: string, canvas: HTMLCanvasElement) {
    this.url = url;
    this.canvas = canvas;
    this.context = canvas.getContext('2d');
  }

  get isPlaying(): boolean {
    return this.isRunning;
  }

  // Resumes on the remembered frame. A file whose repeat allowance is spent stays put —
  // scrolling back may not grant it a fresh play-through (FR-003a).
  start(): void {
    if (this.isRunning) {
      return;
    }
    const position = AnimationRegistry.position(this.url);
    if (position.isFinished) {
      return;
    }
    this.frameIndex = position.frameIndex;
    this.loopsDone = position.loopsDone;
    this.isFinished = false;
    this.nextPlan = null;
    this.pending = null;
    this.isRunning = true;
    // Pinned rather than merely recently-used: acquisition spans three viewports, so plain
    // recency would let a post that is on screen and playing be evicted (research R9).
    AnimationRegistry.pin(this.url);
    void this.step();
  }

  stop(): void {
    if (!this.isRunning) {
      return;
    }
    this.isRunning = false;
    if (this.timer !== null) {
      window.clearTimeout(this.timer);
      this.timer = null;
    }
    this.discardPending();
    AnimationRegistry.unpin(this.url);
    AnimationRegistry.savePosition(this.url, {
      frameIndex: this.frameIndex,
      loopsDone: this.loopsDone,
      isFinished: this.isFinished,
    });
  }

  private async step(): Promise<void> {
    const plan = this.nextPlan ?? { index: this.frameIndex, loops: this.loopsDone, isFinished: false };
    const image = await this.takePending(plan.index);
    if (!this.isRunning) {
      image?.close();
      return;
    }
    if (!image) {
      // Two failed decodes in a row: freeze on the frame already on the canvas rather than
      // blanking a post the visitor is looking at (guarantee 5).
      this.stop();
      return;
    }
    this.frameIndex = plan.index;
    this.loopsDone = plan.loops;
    this.show(image);
  }

  private show(image: VideoFrame): void {
    this.paint(image);
    const delay = AnimatedImage.frameDelayMs(image.duration);
    // VideoFrames hold memory the garbage collector will not reclaim promptly (research R10).
    image.close();
    const plan = this.plan();
    if (plan.isFinished) {
      this.isFinished = true;
      this.loopsDone = plan.loops;
      this.stop();
      return;
    }
    this.nextPlan = plan;
    // Decoded now and awaited by the next step, so a slow decode overlaps the frame's own
    // delay instead of adding to it (research R6).
    this.pending = this.decodeAt(plan.index);
    this.timer = window.setTimeout(() => void this.step(), delay);
  }

  private paint(image: VideoFrame): void {
    if (!this.context) {
      return;
    }
    this.context.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.context.drawImage(image, 0, 0);
  }

  private plan(): FramePlan {
    const last = this.frameCount - 1;
    if (this.frameIndex < last) {
      return { index: this.frameIndex + 1, loops: this.loopsDone, isFinished: false };
    }
    // Wrapping past the final frame completes a play-through. A finite repetitionCount of n
    // means n + 1 play-throughs in total (research R7).
    const loops = this.loopsDone + 1;
    if (this.repetitionCount !== Infinity && loops > this.repetitionCount) {
      return { index: this.frameIndex, loops, isFinished: true };
    }
    return { index: 0, loops, isFinished: false };
  }

  private takePending(index: number): Promise<VideoFrame | null> {
    const pending = this.pending ?? this.decodeAt(index);
    this.pending = null;
    return pending;
  }

  private discardPending(): void {
    const pending = this.pending;
    this.pending = null;
    if (pending) {
      void pending.then((image) => image?.close());
    }
  }

  private async decodeAt(index: number): Promise<VideoFrame | null> {
    const image = await this.decodeOnce(index);
    if (image) {
      return image;
    }
    // One retry through the registry: the usual cause is the decoder having been closed by
    // eviction mid-flight, and a rebuilt session decodes the same frame fine (research R9).
    return await this.decodeOnce(index);
  }

  private async decodeOnce(index: number): Promise<VideoFrame | null> {
    const session = await AnimationRegistry.acquire(this.url);
    if (!session) {
      return null;
    }
    this.frameCount = session.frameCount;
    this.repetitionCount = session.repetitionCount;
    try {
      const result = await session.decoder.decode({ frameIndex: index, completeFramesOnly: true });
      return result.image;
    } catch {
      return null;
    }
  }
}
