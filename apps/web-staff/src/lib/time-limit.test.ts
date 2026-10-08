import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { heldTo } from './time-limit';

/** A dead wifi must not hold the pad: work that talks to the server has a limit. */
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('heldTo', () => {
  it('hands back the work’s own answer when it comes in time, and stops nothing', async () => {
    let signal: AbortSignal | undefined;

    const answer = await heldTo(
      4000,
      async (stop) => {
        signal = stop;
        return 'done';
      },
      'late',
    );
    await vi.advanceTimersByTimeAsync(10_000);

    expect(answer).toBe('done');
    expect(signal?.aborted).toBe(false);
  });

  it('answers `late` at the limit, not before, and tells the work to stop', async () => {
    let signal: AbortSignal | undefined;
    let answer = 'waiting';

    void heldTo(
      4000,
      (stop) => {
        signal = stop;
        return new Promise<string>(() => {});
      },
      'late',
    ).then((ended) => (answer = ended));
    await vi.advanceTimersByTimeAsync(3999);
    expect(answer).toBe('waiting');
    expect(signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);

    expect(answer).toBe('late');
    expect(signal?.aborted).toBe(true);
  });

  it('lets a fault of the work through', async () => {
    await expect(heldTo(4000, () => Promise.reject(new Error('boom')), 'late')).rejects.toThrow(
      'boom',
    );
  });
});
