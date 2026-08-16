/**
 * Collapse a burst of "something changed" signals into as few runs as possible,
 * without making the quiet case slower.
 *
 * `useLiveMatch` subscribes to four tables with `event: '*'` and calls a
 * four-request refresh on every row change. One bulk write — resetting a
 * 16-exchange match — therefore produces ~64 HTTP requests PER SUBSCRIBED
 * DISPLAY: every TV, projector and admin timeline row open on that bout. Live
 * scoring is fine; bulk writes are not.
 *
 * LEADING EDGE MATTERS, and a plain trailing debounce would have been a
 * regression. The normal case is one referee scoring one hit: a single event,
 * which renders instantly today. Trailing-only would delay every one of those
 * by the whole window to fix a problem that only exists during bulk writes —
 * slower scoreboards in every hall, to help the rare case. So an idle
 * coalescer runs immediately and only the FOLLOWING calls are collapsed. A
 * 16-exchange reset becomes two runs (the first, plus one trailing sweep)
 * instead of sixteen, and an isolated hit stays instant.
 *
 * IN-FLIGHT DEDUPE is the other half. A run is async, and more signals arrive
 * while it is out. Starting a second in parallel would race two responses into
 * the same state; dropping them would lose the update. Instead a signal during
 * a run sets a flag, and exactly one more run happens when the current one
 * settles — however many arrived.
 *
 * Pure: no React, no timers beyond setTimeout, no I/O. The caller supplies the
 * work and the window.
 */

export interface Coalescer {
  /** Signal that a run is wanted. Runs now if idle, otherwise collapses. */
  schedule(): void;
  /** Drop a pending trailing run. For effect cleanup. */
  cancel(): void;
}

export function createCoalescer(run: () => Promise<void>, delayMs: number): Coalescer {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let inFlight = false;
  /** A signal arrived while `run` was out — one more run is owed. */
  let rerunWanted = false;
  /** Inside the window since the last run started. */
  let cooling = false;

  async function invoke(): Promise<void> {
    inFlight = true;
    try {
      await run();
    } finally {
      inFlight = false;
      // Settled with signals owed — serve them as one run, not N.
      if (rerunWanted) {
        rerunWanted = false;
        void invoke();
      }
    }
  }

  function startCooling(): void {
    cooling = true;
    timer = setTimeout(() => {
      timer = null;
      cooling = false;
    }, delayMs);
  }

  return {
    schedule(): void {
      if (inFlight) {
        // Never a parallel duplicate, never a dropped update.
        rerunWanted = true;
        return;
      }

      if (!cooling) {
        // Leading edge: idle, so this is the isolated case and it runs now.
        startCooling();
        void invoke();
        return;
      }

      // Inside the window: collapse into one trailing run. Re-arming the timer
      // would let a long burst starve the trailing run indefinitely, so the
      // window that is already running is left alone.
      if (timer !== null) {
        clearTimeout(timer);
        timer = setTimeout(() => {
          timer = null;
          cooling = false;
          void invoke();
        }, delayMs);
      }
    },

    cancel(): void {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      cooling = false;
      rerunWanted = false;
    },
  };
}
