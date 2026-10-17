// Re-checks a post whose upload is still being processed (024), so the permalink swaps to
// the finished post by itself. An INSTANCE class, like AnimationPlayer (research R15): it
// owns a timer handle and a stopped flag that belong to one page view, not to the module.
//
// A tick is scheduled only after the previous one has settled, so a slow response can never
// stack a second request behind it. A hidden tab schedules nothing at all — no timer, no
// request — and picks up again on the next visibilitychange.
export class ProcessingPoll {
  static readonly INTERVAL_MS = 2000;

  private readonly tick: () => Promise<void>;
  private timer: number | null = null;
  private isStopped = false;

  constructor(tick: () => Promise<void>) {
    this.tick = tick;
    this.fire = this.fire.bind(this);
    this.schedule = this.schedule.bind(this);
  }

  start(): void {
    document.addEventListener('visibilitychange', this.schedule);
    this.schedule();
  }

  stop(): void {
    this.isStopped = true;
    document.removeEventListener('visibilitychange', this.schedule);
    if (this.timer !== null) {
      window.clearTimeout(this.timer);
      this.timer = null;
    }
  }

  // Also the visibilitychange listener: a tab coming back into view resumes, one going away
  // is ignored here and simply skipped when its pending timer fires.
  private schedule(): void {
    if (this.isStopped || this.timer !== null || document.hidden) {
      return;
    }
    this.timer = window.setTimeout(this.fire, ProcessingPoll.INTERVAL_MS);
  }

  private async fire(): Promise<void> {
    this.timer = null;
    if (this.isStopped || document.hidden) {
      return;
    }
    await this.tick();
    this.schedule();
  }
}
