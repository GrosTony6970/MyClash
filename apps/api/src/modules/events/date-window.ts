/**
 * Date-window helpers for the public event catalogue.
 *
 * `events.start_date` / `end_date` are TEXT holding ISO dates, so comparisons
 * are lexicographic — which is exact for `YYYY-MM-DD`.
 *
 * Pure, no I/O.
 */

/**
 * The day after `iso`, as `YYYY-MM-DD`.
 *
 * Used to express "on or before day D" as `start_date < nextIsoDay(D)` rather
 * than `start_date <= D`. The two are equivalent for plain dates, but the
 * exclusive-upper-bound form stays correct if a row ever holds a full
 * timestamp: '2026-06-01T10:00' is NOT <= '2026-06-01', but it is
 * < '2026-06-02'. That asymmetry is the whole reason this helper exists.
 */
export function nextIsoDay(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) throw new Error(`nextIsoDay: not an ISO date: ${iso}`);
  // Date.UTC normalises overflow (month 13 → next January, day 32 → next
  // month), so month-end, month-length and leap years all fall out for free.
  const next = new Date(Date.UTC(y, m - 1, d + 1));
  return next.toISOString().slice(0, 10);
}

/**
 * True when an event spanning [start, end] overlaps the window [from, to].
 * Mirrors the predicate the service pushes down to PostgREST, so the two can
 * be tested against each other.
 */
export function overlapsWindow(
  event: { start: string; end: string | null },
  window: { from?: string | null; to?: string | null },
): boolean {
  const end = event.end ?? event.start;
  if (window.from && end < window.from) return false;
  if (window.to && event.start >= nextIsoDay(window.to)) return false;
  return true;
}
