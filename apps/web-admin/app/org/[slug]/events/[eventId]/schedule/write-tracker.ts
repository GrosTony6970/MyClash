/**
 * Is a write to the schedule in flight?
 *
 * The realtime gate asks this to decide whether to hold a refetch off. It used
 * to be answered by `saving`, the state that dims the one match card being
 * PATCHed — so it was true only during a single-fight move, and false during
 * every programme-block move, break edit, delete, group re-fan and bulk shift.
 * Those are the writes with the widest blast radius and the longest cascades,
 * and they were exactly the ones realtime was free to interrupt.
 *
 * A counter rather than a boolean because writes overlap: a group drop is a
 * fan-out of PATCHes, and the first one to finish must not report the board
 * idle while the rest are still going.
 *
 * `saving` keeps its one job. It is a rendering signal — which card to dim —
 * and widening it to mean "busy" would have dimmed everything.
 *
 * Pure: no React. The hook holds one of these for the component's lifetime.
 */

export interface WriteTracker {
  /** Run `work`, counting it as in flight until it settles. Rethrows, so a
   *  caller's own error handling is untouched. */
  track: <T>(work: () => Promise<T>) => Promise<T>;
  isBusy: () => boolean;
}

export function createWriteTracker(): WriteTracker {
  let inFlight = 0;
  return {
    async track<T>(work: () => Promise<T>): Promise<T> {
      inFlight += 1;
      try {
        return await work();
      } finally {
        // In `finally`, so a refused write does not leave the board looking
        // busy forever and realtime silent with it.
        inFlight -= 1;
      }
    },
    isBusy: () => inFlight > 0,
  };
}
