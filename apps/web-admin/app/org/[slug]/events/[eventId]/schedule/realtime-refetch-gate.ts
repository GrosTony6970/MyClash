/**
 * When the board re-reads itself after somebody else changes the schedule.
 *
 * Two jobs. Coalesce a burst of realtime events into one refetch, and hold that
 * refetch off while a local write is in flight so an echo cannot fight an
 * optimistic drag.
 *
 * THE FIX THIS CARRIES: a suppressed tick used to be dropped, not deferred —
 * `if (isBusy()) return;` and nothing rearmed it. That is only harmless if
 * something else re-reads later, and nothing does: the 30-second poll exists
 * only while the websocket is DOWN, and a successful write never refetches. So a
 * remote change landing during a local save was lost until the next unrelated
 * event, and the operator worked from a board that was quietly stale. It now
 * rearms at the same delay and fires when the write finishes.
 *
 * Pure: no React, no timers of its own. `setTimer`/`clearTimer` are injected, so
 * the gate can be driven at full speed in a test — which is the only reason this
 * behaviour has any cover at all. The drag specs run against a dead Supabase
 * URL, so realtime never delivers an event to them.
 */

export interface RefetchGate {
  /** A reason to re-read arrived. Restarts the debounce window. */
  schedule(): void;
  /** Drop any pending refetch — the board is going away. */
  cancel(): void;
}

export function createRefetchGate(args: {
  delayMs: number;
  /** True while a local write is in flight. Read at FIRE time, never at
   *  schedule time: a write that starts after the tick is armed still has to
   *  suppress it. */
  isBusy: () => boolean;
  refetch: () => void;
  setTimer: (fn: () => void, ms: number) => number;
  clearTimer: (id: number) => void;
}): RefetchGate {
  const { delayMs, isBusy, refetch, setTimer, clearTimer } = args;
  let pending: number | null = null;

  function arm(): void {
    pending = setTimer(() => {
      pending = null;
      if (isBusy()) {
        // Rearm rather than return. The write will end, and this is the only
        // thing that will re-read the board when it does.
        arm();
        return;
      }
      refetch();
    }, delayMs);
  }

  return {
    schedule(): void {
      if (pending !== null) clearTimer(pending);
      arm();
    },
    cancel(): void {
      if (pending === null) return;
      clearTimer(pending);
      pending = null;
    },
  };
}
