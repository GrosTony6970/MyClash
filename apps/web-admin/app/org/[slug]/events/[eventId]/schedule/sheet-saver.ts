/**
 * When the planner's sheet is written.
 *
 * The sheet saves as the organiser types (ADR-018), so a burst of keystrokes
 * has to become one write, and a write already on its way must never be
 * overtaken by an older one. THE RACE, named:
 *
 *   - several edits inside the window: one write, with the latest sheet;
 *   - an edit while a write is in flight: exactly one more write after it,
 *     with the latest sheet, and never two writes at once;
 *   - so the last sheet typed is the last one stored.
 *
 * `flush()` sends a pending sheet at once and resolves when every write has
 * settled, so Suggest and Generate never run ahead of a save.
 *
 * Nothing here writes when it is built. A mount, StrictMode's double mount
 * included, sends nothing; only `schedule()` from a change handler does.
 *
 * It is not `createRefetchGate` (./realtime-refetch-gate): that gate carries no
 * payload and cannot be waited on, and a save must know what to send and let a
 * caller wait for it.
 *
 * Pure: no React, no timers of its own. `setTimer`/`clearTimer` are injected so
 * a test can drive the window.
 */

export interface SheetSaver<T> {
  /** The sheet changed. Restarts the window with this sheet as the one to send. */
  schedule(next: T): void;
  /** Send a pending sheet now; resolve once every write has settled. */
  flush(): Promise<void>;
}

export function createSheetSaver<T>(args: {
  delayMs: number;
  /** Sends one sheet. */
  write: (sheet: T) => Promise<void>;
  /** Every refused write lands here, so a refusal cannot vanish. */
  onError: (err: unknown) => void;
  setTimer: (fn: () => void, ms: number) => number;
  clearTimer: (id: number) => void;
}): SheetSaver<T> {
  const { delayMs, write, onError, setTimer, clearTimer } = args;
  // Boxed, so a sheet that is itself falsy still counts as pending.
  let pending: { sheet: T } | null = null;
  let timer: number | null = null;
  let inFlight: Promise<void> | null = null;

  function send(): void {
    if (inFlight !== null || pending === null) return;
    const { sheet } = pending;
    pending = null;
    inFlight = write(sheet)
      .catch(onError)
      .finally(() => {
        inFlight = null;
        // An edit arrived mid-write and its window has already closed, so its
        // timer found a write in flight and sent nothing. Send it now. An edit
        // whose window is still open is sent by its own timer.
        if (timer === null) send();
      });
  }

  return {
    schedule(next: T): void {
      pending = { sheet: next };
      if (timer !== null) clearTimer(timer);
      timer = setTimer(() => {
        timer = null;
        send();
      }, delayMs);
    },
    async flush(): Promise<void> {
      if (timer !== null) {
        clearTimer(timer);
        timer = null;
      }
      send();
      while (inFlight !== null) await inFlight;
    },
  };
}
