import { describe, expect, it } from 'vitest';
import { createWriteTracker } from './write-tracker';

describe('createWriteTracker', () => {
  it('is idle before anything is written', () => {
    expect(createWriteTracker().isBusy()).toBe(false);
  });

  it('reports busy for the whole of a write', async () => {
    const tracker = createWriteTracker();
    let seenDuringWrite: boolean | null = null;
    await tracker.track(async () => {
      seenDuringWrite = tracker.isBusy();
    });
    expect(seenDuringWrite).toBe(true);
    expect(tracker.isBusy()).toBe(false);
  });

  it('stays busy until the LAST of an overlapping fan-out settles', async () => {
    // A group drop is many PATCHes at once. A boolean would go false on the
    // first one to finish and let a realtime echo land on top of the rest.
    const tracker = createWriteTracker();
    let releaseSlow = (): void => {};
    const slow = new Promise<void>((resolve) => {
      releaseSlow = resolve;
    });

    const first = tracker.track(async () => {});
    const second = tracker.track(() => slow);
    await first;

    expect(tracker.isBusy()).toBe(true);
    releaseSlow();
    await second;
    expect(tracker.isBusy()).toBe(false);
  });

  it('goes idle again when a write is refused', async () => {
    // Without the finally, one rejected PATCH would leave the board looking
    // busy for the rest of the session and realtime silent with it.
    const tracker = createWriteTracker();
    await expect(tracker.track(() => Promise.reject(new Error('refused')))).rejects.toThrow(
      'refused',
    );
    expect(tracker.isBusy()).toBe(false);
  });
});
