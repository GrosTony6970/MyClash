/**
 * Vertical window for the public workshop grid.
 *
 * The organizer board reads its start/end hour from the operator's localStorage
 * (they have selectors for it); the public grid has no controls, so it derives
 * the window from the data instead. Pure — no React, no I/O — so it stays
 * testable apart from the loader that consumes it.
 */

import { minutesIntoDayInZone } from '@myclash/time';
import { computeGridEndSlot, computeGridStartHour } from '@myclash/schedule-core';

/**
 * First hour of the axis: 08:00 (the organizer board's default, so the two look
 * alike), pulled EARLIER when the day actually starts before it.
 *
 * Going earlier matters — `isoToSlot` clamps negative slots to 0, so a 07:00
 * session on an 08:00 axis silently renders at 08:00, stacked on whatever is
 * genuinely there. Never going later keeps the familiar look.
 *
 * The rule itself now lives in `computeGridStartHour`; this only resolves the
 * two input shapes this grid has. The organiser board derives its origin the
 * same way — one definition, two callers.
 */
export function deriveStartHour(
  sessionStartsIso: ReadonlyArray<string>,
  breakStartHHMM: ReadonlyArray<string>,
  tz: string,
): number {
  const sessionMinutes = sessionStartsIso
    .map((iso) => minutesIntoDayInZone(iso, tz))
    .filter((min): min is number => min !== null);
  const breakMinutes = breakStartHHMM
    .map((hhmm) => Number(hhmm.slice(0, 2)) * 60)
    .filter((min) => Number.isFinite(min));
  return computeGridStartHour([...sessionMinutes, ...breakMinutes]);
}

/**
 * Vertical extent for one day: the 20:00 floor, grown to cover the latest block
 * or break and rounded up to a whole hour, clamped at midnight.
 *
 * This used to be a separate implementation, and the note here said not to
 * deduplicate it because `computeGridEndSlot` hardcoded 08:00 as the origin.
 * That is no longer true — it takes `startHour` — so the duplicate is gone.
 */
export function dayEndSlot(startHour: number, endSlots: ReadonlyArray<number>): number {
  return computeGridEndSlot({
    blockEndSlots: [...endSlots],
    breakEndSlots: [],
    dayEndHHMM: null,
    startHour,
  });
}
