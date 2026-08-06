import type { BoardRow, LiveBoardTiming } from './types';

/**
 * The timing lens: how long a bout has been running, how far behind schedule a
 * piste is, and when the day is likely to finish.
 *
 * Pure — no React, no clock of its own. Every function takes `nowMs` so the
 * caller can drive it from the shared (simulation-aware) seconds clock and so
 * the tests are not time-dependent.
 *
 * All values are SECONDS and never negative: a bout that started early is not
 * "-90s late", it is simply not late, and clamping here keeps every caller from
 * repeating the same guard.
 */

function secondsBetween(fromIso: string | null, toMs: number): number | null {
  if (!fromIso) return null;
  const from = Date.parse(fromIso);
  if (Number.isNaN(from)) return null;
  return Math.max(0, Math.round((toMs - from) / 1000));
}

/** How long the bout has been under way, or null if it has not started. */
export function elapsedSec(row: BoardRow, nowMs: number): number | null {
  return secondsBetween(row.currentMatch?.startedAt ?? null, nowMs);
}

/**
 * How late the bout started against its slot.
 *
 * Measured at the START, not against now — once a bout is under way, "it began
 * 6 minutes late" is a fixed fact about the day's drift. Growing it as the bout
 * runs would double-count the overrun that `runningOverSec` already reports.
 */
export function startedLateSec(row: BoardRow): number | null {
  const cm = row.currentMatch;
  if (!cm?.startedAt || !cm.scheduledAt) return null;
  const started = Date.parse(cm.startedAt);
  const scheduled = Date.parse(cm.scheduledAt);
  if (Number.isNaN(started) || Number.isNaN(scheduled)) return null;
  return Math.max(0, Math.round((started - scheduled) / 1000));
}

/**
 * How overdue a not-yet-started bout is.
 *
 * Only meaningful while the bout is still `scheduled`; a running bout's
 * lateness is `startedLateSec`.
 */
export function dueForSec(row: BoardRow, nowMs: number): number | null {
  const cm = row.currentMatch;
  if (!cm || cm.startedAt) return null;
  return secondsBetween(cm.scheduledAt, nowMs);
}

/**
 * How long this piste has had nobody fighting on it.
 *
 * Measured from the last bout's end, because that is the moment the piste
 * became free. With no history (the day has not started here) there is nothing
 * to be idle *since*, so this is null rather than a huge number.
 */
export function idleForSec(row: BoardRow, nowMs: number): number | null {
  return secondsBetween(row.lastCompleted?.endedAt ?? null, nowMs);
}

/**
 * Seconds a running bout has exceeded its planned length.
 *
 * `matchDurationMinutes` is the programme block's planned slot (or the
 * documented default), so this is a schedule signal, not a rule about how long
 * a fight may last.
 */
export function runningOverSec(
  row: BoardRow,
  nowMs: number,
  matchDurationMinutes: number,
): number | null {
  const elapsed = elapsedSec(row, nowMs);
  if (elapsed === null) return null;
  return Math.max(0, elapsed - matchDurationMinutes * 60);
}

/**
 * When the event is likely to finish, in epoch ms.
 *
 * Deliberately crude: bouts remaining × planned bout length ÷ pistes running,
 * offset from now. It answers "are we going to overrun by 20 minutes or by two
 * hours", which is the only resolution an organizer acts on. Null when nothing
 * is running or nothing is left — a projection off zero pistes is a divide by
 * zero dressed up as information.
 */
export function projectedFinishMs(
  nowMs: number,
  remaining: number,
  activePistes: number,
  matchDurationMinutes: number,
): number | null {
  if (remaining <= 0 || activePistes <= 0) return null;
  const roundsLeft = Math.ceil(remaining / activePistes);
  return nowMs + roundsLeft * matchDurationMinutes * 60_000;
}

/** The board's clock, defaulted for an API that has not shipped timing yet. */
export function fallbackTiming(nowMs: number): LiveBoardTiming {
  return {
    nowIso: new Date(nowMs).toISOString(),
    matchDurationMinutes: 5,
    block: null,
  };
}
