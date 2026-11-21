import { describe, expect, it } from 'vitest';
import { retriesAfterError, retryDelayMs, triesAfter } from './retry-after-error';
import type { SyncState } from './sync';

/**
 * SYNC ERROR tries again by itself (ruling 954). It waited for the referee's
 * Retry, another hit or another bout: a hit the server answered with a 500
 * waited for ever if nobody touched the tablet.
 */
const state = (over: Partial<SyncState>): SyncState => ({
  status: 'error',
  pendingCount: 1,
  rejectedCount: 0,
  sendableCount: 0,
  heldPressCount: 0,
  freeCount: 1,
  ...over,
});

describe('retryDelayMs', () => {
  it('waits 5 s, then doubles, and never more than a minute', () => {
    expect([0, 1, 2, 3, 4, 5, 9].map(retryDelayMs)).toEqual([
      5_000, 10_000, 20_000, 40_000, 60_000, 60_000, 60_000,
    ]);
  });
});

describe('retriesAfterError', () => {
  it('tries when the bar says SYNC ERROR over rows a send can try', () => {
    expect(retriesAfterError(state({}))).toBe(true);
  });

  it('leaves the rows held in Review to the Retry button', () => {
    expect(retriesAfterError(state({ freeCount: 0, rejectedCount: 2 }))).toBe(false);
  });

  it('leaves the other states to their own owners', () => {
    for (const status of ['idle', 'syncing', 'offline', 'maintenance', 'signed-out'] as const) {
      expect(retriesAfterError(state({ status })), status).toBe(false);
    }
    expect(retriesAfterError(null)).toBe(false);
  });
});

describe('triesAfter', () => {
  it('keeps the count through the send a try starts, and the error it ends in', () => {
    expect(triesAfter(3, state({ status: 'syncing' }))).toBe(3);
    expect(triesAfter(3, state({ status: 'error' }))).toBe(3);
  });

  it('starts again at 5 s once the error is over', () => {
    expect(triesAfter(3, state({ status: 'idle', pendingCount: 0, freeCount: 0 }))).toBe(0);
    expect(triesAfter(3, state({ status: 'offline' }))).toBe(0);
  });
});
