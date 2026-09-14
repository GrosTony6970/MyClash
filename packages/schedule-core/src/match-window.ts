/**
 * A Match's time window, and the hull of a run of Matches (ADR-017).
 *
 * The window is half-open, `[start, start + planned length)`: a bout that ends
 * at 10:30 and one that starts at 10:30 do not overlap. A Pool has no time of
 * its own — its span is the hull of its Matches, earliest start to latest END.
 *
 * There is no default length. The caller passes the planned length (ADR-018);
 * a reader that invents one is the defect this module exists to remove.
 *
 * Pure: `Date.parse` and arithmetic only, so the process timezone plays no
 * part. An ISO without an offset would be read as local time — the API never
 * sends one.
 */

export interface TimeWindowMs {
  startMs: number;
  endMs: number;
}

/**
 * The planned window of a Match.
 *
 * Throws a RangeError on a start it cannot read or a length that is not a
 * finite number above zero. Both would otherwise hide a clash instead of
 * reporting it: under the half-open test a zero-length window at 10:00 does not
 * overlap a bout that starts at 10:00, and a NaN window overlaps nothing.
 */
export function matchWindowMs(
  scheduledAtIso: string,
  plannedDurationMinutes: number,
): TimeWindowMs {
  const startMs = Date.parse(scheduledAtIso);
  if (!Number.isFinite(startMs)) {
    throw new RangeError(`matchWindowMs: cannot read the start time "${scheduledAtIso}"`);
  }
  if (!Number.isFinite(plannedDurationMinutes) || plannedDurationMinutes <= 0) {
    throw new RangeError(
      `matchWindowMs: the planned length must be a positive number of minutes, got ${plannedDurationMinutes}`,
    );
  }
  return { startMs, endMs: startMs + plannedDurationMinutes * 60_000 };
}

/**
 * Earliest start to latest end; null when there is no window. Order does not
 * matter. Trusts its input: build each window with `matchWindowMs`, which is
 * what refuses a NaN or an end before its start.
 */
export function hullMs(windows: readonly TimeWindowMs[]): TimeWindowMs | null {
  if (windows.length === 0) return null;
  let startMs = Number.POSITIVE_INFINITY;
  let endMs = Number.NEGATIVE_INFINITY;
  for (const w of windows) {
    if (w.startMs < startMs) startMs = w.startMs;
    if (w.endMs > endMs) endMs = w.endMs;
  }
  return { startMs, endMs };
}

/** True when the two half-open windows share an instant. Touching is not overlapping. */
export function overlapsHalfOpen(a: TimeWindowMs, b: TimeWindowMs): boolean {
  return a.startMs < b.endMs && b.startMs < a.endMs;
}
