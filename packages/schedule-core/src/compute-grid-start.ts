/**
 * Dynamic origin for the schedule board's time axis — the mirror of
 * `compute-grid-end.ts`.
 *
 * The axis used to start at a hard `GRID_START_HOUR = 8`, and both converters
 * clamped anything earlier to slot 0 (`Math.max(0, …)`). A 07:30 gear-check
 * block therefore RENDERED at 08:00, and dragging anything near it wrote that
 * wrong time back — the operator's own configuration silently overruled.
 * Nothing floors a 07:30 block on the way in: the planner's day-start field
 * takes any `HH:MM`, and the generator seeds the day from it.
 *
 * So the origin is derived from the day's content, exactly as the end is. It
 * caps at `DEFAULT_GRID_START_HOUR` so an ordinary event is unchanged, and it
 * floors at midnight.
 *
 * Pure: no React, no I/O.
 */
import { DEFAULT_GRID_START_HOUR } from './schedule-grid-geometry';

/**
 * The hour the axis should begin at, given the earliest content on the day.
 *
 * `startMinutes` are minutes since local midnight, already resolved in the
 * event's timezone by the caller — this module never touches zones, the same
 * split `compute-grid-end.ts` uses for slots.
 *
 * An empty day keeps the default. Anything at or after the default hour keeps
 * the default too, so the common event never shifts.
 */
export function computeGridStartHour(startMinutes: readonly number[]): number {
  let earliest = DEFAULT_GRID_START_HOUR * 60;
  for (const minutes of startMinutes) {
    if (!Number.isFinite(minutes)) continue;
    if (minutes < earliest) earliest = minutes;
  }
  // Whole hours only: the ruler prints hourly labels, and a half-hour origin
  // would put every one of them on :30.
  return Math.max(0, Math.floor(earliest / 60));
}
