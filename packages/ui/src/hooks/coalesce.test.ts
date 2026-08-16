import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCoalescer } from './coalesce';

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

/** A run that resolves immediately, so only the timer drives the test. */
function instantRun() {
  return vi.fn().mockResolvedValue(undefined);
}

describe('createCoalescer', () => {
  it('runs an isolated signal IMMEDIATELY', async () => {
    // The property a plain trailing debounce would have cost. One referee, one
    // hit, one row change is the normal case and it renders instantly today;
    // delaying it by the whole window to help bulk writes would make every
    // scoreboard in the hall slower.
    const run = instantRun();
    const c = createCoalescer(run, 200);

    c.schedule();

    expect(run).toHaveBeenCalledTimes(1);
  });

  it('collapses a burst into the leading run plus ONE trailing run', async () => {
    const run = instantRun();
    const c = createCoalescer(run, 200);

    // A 16-exchange reset: sixteen events inside the window.
    for (let i = 0; i < 16; i++) c.schedule();
    expect(run).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(200);

    expect(run).toHaveBeenCalledTimes(2);
  });

  it('does not fire a trailing run when nothing followed the first', async () => {
    const run = instantRun();
    const c = createCoalescer(run, 200);

    c.schedule();
    await vi.advanceTimersByTimeAsync(500);

    expect(run).toHaveBeenCalledTimes(1);
  });

  it('runs again for a signal arriving after the window closed', async () => {
    const run = instantRun();
    const c = createCoalescer(run, 200);

    c.schedule();
    await vi.advanceTimersByTimeAsync(300);
    c.schedule();

    expect(run).toHaveBeenCalledTimes(2);
  });

  it('never runs twice in parallel while one is in flight', async () => {
    let release!: () => void;
    const run = vi.fn().mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const c = createCoalescer(run, 200);

    c.schedule();
    expect(run).toHaveBeenCalledTimes(1);

    // Five more while the first is still out.
    for (let i = 0; i < 5; i++) c.schedule();
    expect(run).toHaveBeenCalledTimes(1);

    release();
    await vi.advanceTimersByTimeAsync(0);

    // Exactly one more — not five, and not zero.
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('does not lose the last update when signals arrive mid-run', async () => {
    // The failure a naive "skip while busy" would ship: the state that arrived
    // during the run never gets fetched, and the board sits stale until the
    // next unrelated event.
    let release!: () => void;
    const run = vi.fn().mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const c = createCoalescer(run, 200);

    c.schedule();
    c.schedule();
    release();
    await vi.advanceTimersByTimeAsync(0);

    expect(run).toHaveBeenCalledTimes(2);
  });

  it('cancel drops a pending trailing run', async () => {
    const run = instantRun();
    const c = createCoalescer(run, 200);

    c.schedule();
    c.schedule();
    c.cancel();
    await vi.advanceTimersByTimeAsync(500);

    // Only the leading run happened; the trailing one was dropped on unmount.
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('is usable again after cancel', async () => {
    const run = instantRun();
    const c = createCoalescer(run, 200);

    c.schedule();
    c.cancel();
    // Let the first run settle. Scheduling before it does is the in-flight
    // case, not the cancelled one — `cancel` clears the window, not the
    // promise that is already out.
    await vi.advanceTimersByTimeAsync(0);
    c.schedule();

    expect(run).toHaveBeenCalledTimes(2);
  });
});
