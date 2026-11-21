import type { SyncState } from './sync';

/**
 * The waits before each try when the bar says SYNC ERROR (ruling 954): 5 s,
 * then doubling, capped at a minute. A server in trouble gets one try a minute
 * from each tablet, not one every 5 seconds.
 */
export const RETRY_AFTER_ERROR_MS = [5_000, 10_000, 20_000, 40_000, 60_000] as const;

/** The wait before try `tries` (0 for the first) after a send ended in SYNC ERROR. */
export function retryDelayMs(tries: number): number {
  const last = RETRY_AFTER_ERROR_MS.length - 1;
  return RETRY_AFTER_ERROR_MS[Math.min(Math.max(0, tries), last)]!;
}

/**
 * SYNC ERROR with rows a send can try. Rows held in Review are not retried by
 * a timer (ruling 291): the referee's Retry sends them once the cause is fixed.
 */
export function retriesAfterError(state: SyncState | null): boolean {
  return state?.status === 'error' && state.freeCount > 0;
}

/**
 * The tries counted so far, after the engine said `state`. A try is a send, so
 * the count lives through `syncing` and the `error` it ends in; any other state
 * means the error is over, and the next one starts at 5 s again.
 */
export function triesAfter(tries: number, state: SyncState | null): number {
  if (state === null || state.status === 'error' || state.status === 'syncing') return tries;
  return 0;
}
