import { roundUpToHalfHourMin } from '../../schedule/round-duration';

/**
 * The scheduled BLOCK-window end shown on the referees assignment cards: the run
 * start plus the run duration rounded up to the next half hour — the exact value
 * the schedule grid shows for the block (mirrors `buildScheduleBlocks`, which
 * does `start + roundUpToHalfHourMin(runDuration)`). So the two views agree
 * instead of the cards showing the precise last-fight end (e.g. 09:00–11:34)
 * while the grid shows the rounded block (09:00–12:00).
 *
 * Display-only: the API's real run end (`pool.scheduledEnd`) still drives
 * referee conflict detection — we round for display here, not at the source.
 * Falls back to the raw end ISO when the inputs are unusable.
 *
 * Pure: no React, no I/O.
 */
export function blockWindowEndIso(startIso: string, realEndIso: string): string {
  const startMs = new Date(startIso).getTime();
  const endMs = new Date(realEndIso).getTime();
  if (Number.isNaN(startMs) || Number.isNaN(endMs) || endMs <= startMs) return realEndIso;
  const rounded = roundUpToHalfHourMin((endMs - startMs) / 60_000);
  return new Date(startMs + rounded * 60_000).toISOString();
}
