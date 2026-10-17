// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ProcessingPoll } from '../../src/lib/processingPoll';

// jsdom's document.hidden is a getter on the prototype; tests flip it per case.
function setHidden(isHidden: boolean): void {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => isHidden });
  document.dispatchEvent(new Event('visibilitychange'));
}

beforeEach(() => {
  vi.useFakeTimers();
  setHidden(false);
});

afterEach(() => {
  vi.useRealTimers();
  setHidden(false);
});

describe('ProcessingPoll', () => {
  it('ticks every interval while visible', async () => {
    const tick = vi.fn().mockResolvedValue(undefined);
    const poll = new ProcessingPoll(tick);
    poll.start();

    await vi.advanceTimersByTimeAsync(ProcessingPoll.INTERVAL_MS - 1);
    expect(tick).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(tick).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(ProcessingPoll.INTERVAL_MS);
    expect(tick).toHaveBeenCalledTimes(2);
    poll.stop();
  });

  it('never overlaps a slow tick with the next one', async () => {
    let finish: () => void = () => undefined;
    const tick = vi.fn().mockImplementation(() => new Promise<void>((resolve) => {
      finish = resolve;
    }));
    const poll = new ProcessingPoll(tick);
    poll.start();

    await vi.advanceTimersByTimeAsync(ProcessingPoll.INTERVAL_MS * 5);
    expect(tick).toHaveBeenCalledTimes(1);

    finish();
    await vi.advanceTimersByTimeAsync(ProcessingPoll.INTERVAL_MS);
    expect(tick).toHaveBeenCalledTimes(2);
    poll.stop();
  });

  it('stops ticking once stopped', async () => {
    const tick = vi.fn().mockResolvedValue(undefined);
    const poll = new ProcessingPoll(tick);
    poll.start();
    poll.stop();

    await vi.advanceTimersByTimeAsync(ProcessingPoll.INTERVAL_MS * 3);
    expect(tick).not.toHaveBeenCalled();
  });

  it('does not tick again after a tick that ended with a stop', async () => {
    let ticks = 0;
    const poll = new ProcessingPoll(async () => {
      ticks += 1;
      poll.stop();
    });
    poll.start();

    await vi.advanceTimersByTimeAsync(ProcessingPoll.INTERVAL_MS * 3);
    expect(ticks).toBe(1);
  });

  it('pauses while the tab is hidden and resumes when it is shown again', async () => {
    const tick = vi.fn().mockResolvedValue(undefined);
    const poll = new ProcessingPoll(tick);
    poll.start();

    setHidden(true);
    await vi.advanceTimersByTimeAsync(ProcessingPoll.INTERVAL_MS * 5);
    expect(tick).not.toHaveBeenCalled();

    setHidden(false);
    await vi.advanceTimersByTimeAsync(ProcessingPoll.INTERVAL_MS);
    expect(tick).toHaveBeenCalledTimes(1);
    poll.stop();
  });

  it('does not start a timer when started in a hidden tab', async () => {
    setHidden(true);
    const tick = vi.fn().mockResolvedValue(undefined);
    const poll = new ProcessingPoll(tick);
    poll.start();

    await vi.advanceTimersByTimeAsync(ProcessingPoll.INTERVAL_MS * 3);
    expect(tick).not.toHaveBeenCalled();
    poll.stop();
  });

  it('ignores a visibility change after it was stopped', async () => {
    const tick = vi.fn().mockResolvedValue(undefined);
    const poll = new ProcessingPoll(tick);
    poll.start();
    poll.stop();

    setHidden(true);
    setHidden(false);
    await vi.advanceTimersByTimeAsync(ProcessingPoll.INTERVAL_MS * 3);
    expect(tick).not.toHaveBeenCalled();
  });
});
