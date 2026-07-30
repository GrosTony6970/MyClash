/**
 * bout-flow-clock.ts — where the clock stopped, in match time.
 *
 * A bout's flow chart is drawn against ACCUMULATED ACTIVE ms, so a stoppage has
 * no width on it: halted time never advances the match clock. That is the
 * honest reading — no match time passed — and it turns a pause into a marker at
 * a single offset rather than a band. Its real-world length is reported
 * separately, because "the clock sat stopped for 40 seconds here" is the part a
 * flat stretch of chart cannot tell you.
 *
 * Pure: no React, no I/O.
 */

import type { ClockEvent } from '../types/match-events';

/** A clock stoppage, positioned in match time (so it has no width). */
export interface BoutFlowPause {
  /** Match-clock position the clock was halted at. */
  elapsedMs: number;
  /** Real-world duration of the stoppage. 0 while still halted. */
  stoppageMs: number;
}

/** Running fold state — mirrors `ClockService.computeClockState`'s locals. */
interface Fold {
  activeMs: number;
  runningFrom: string | null;
  open: { pause: BoutFlowPause; at: string } | null;
  pauses: BoutFlowPause[];
}

/** Close the running interval into the accumulated total. */
function bank(fold: Fold, at: number): void {
  if (!fold.runningFrom) return;
  fold.activeMs += Math.max(0, at - Date.parse(fold.runningFrom));
  fold.runningFrom = null;
}

function step(fold: Fold, ev: ClockEvent): void {
  const at = Date.parse(ev.occurredAt);
  switch (ev.type) {
    case 'start':
    case 'resume':
      if (fold.open && Number.isFinite(at)) {
        fold.open.pause.stoppageMs = Math.max(0, at - Date.parse(fold.open.at));
        fold.open = null;
      }
      fold.runningFrom = ev.occurredAt;
      break;
    case 'halt': {
      bank(fold, at);
      const pause: BoutFlowPause = { elapsedMs: fold.activeMs, stoppageMs: 0 };
      fold.pauses.push(pause);
      fold.open = { pause, at: ev.occurredAt };
      break;
    }
    case 'end':
      bank(fold, at);
      break;
    case 'reopen':
      fold.runningFrom = null;
      break;
    case 'reset_clock':
    case 'reset_match':
      // The clock went back to zero, so every marker so far is meaningless.
      fold.activeMs = 0;
      fold.runningFrom = null;
      fold.open = null;
      fold.pauses.length = 0;
      break;
    case 'adjust_time':
      // Honoured deliberately: skip it and these offsets drift away from the
      // `clockTimeMs` stamped on the exchanges, landing markers in the wrong
      // place on the very chart they are meant to explain.
      fold.activeMs = Math.max(0, fold.activeMs + (ev.adjustmentMs ?? 0));
      break;
  }
}

/** Replay the clock's transitions into stoppage markers. */
export function foldPauses(events: ClockEvent[]): BoutFlowPause[] {
  const fold: Fold = { activeMs: 0, runningFrom: null, open: null, pauses: [] };
  for (const ev of events) step(fold, ev);
  return fold.pauses;
}
