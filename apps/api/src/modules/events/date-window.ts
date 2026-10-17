/**
 * Date-window helpers for the public event catalogue.
 *
 * `events.start_date` / `end_date` are DATE (0223) and travel as `YYYY-MM-DD`,
 * so a text comparison of two of them is exact.
 *
 * Pure, no I/O.
 */

/** The refusal of an Event whose end comes before its start (`createEvent`, `updateEvent`). */
export const END_BEFORE_START = 'The Event cannot end before it starts';

/**
 * True when an event spanning [start, end] overlaps the window [from, to].
 * Mirrors the predicate the service pushes down to PostgREST, so the two can
 * be tested against each other. Both bounds are days, compared as days: the
 * columns hold no time (0223), so "starts on or before `to`" is `start <= to`.
 */
export function overlapsWindow(
  event: { start: string; end: string | null },
  window: { from?: string | null; to?: string | null },
): boolean {
  const end = event.end ?? event.start;
  if (window.from && end < window.from) return false;
  if (window.to && event.start > window.to) return false;
  return true;
}
