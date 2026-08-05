/**
 * Vertical window for the public workshop grid.
 *
 * The organizer board reads its start/end hour from the operator's localStorage
 * (they have selectors for it); the public grid has no controls, so it derives
 * the window from the data instead. Pure — no React, no I/O — so it stays
 * testable apart from the loader that consumes it.
 */

import { minutesIntoDayInZone } from '@myclash/time';
import { DEFAULT_GRID_END_HOUR, GRID_START_HOUR, SLOT_MINUTES } from '@myclash/schedule-core';

const SLOTS_PER_HOUR = 60 / SLOT_MINUTES;

/**
 * First hour of the axis: 08:00 (the organizer board's default, so the two look
 * alike), pulled EARLIER when the day actually starts before it.
 *
 * Going earlier matters — `isoToSlot` clamps negative slots to 0, so a 07:00
 * session on an 08:00 axis silently renders at 08:00, stacked on whatever is
 * genuinely there. Never going later keeps the familiar look.
 */
export function deriveStartHour(
  sessionStartsIso: ReadonlyArray<string>,
  breakStartHHMM: ReadonlyArray<string>,
  tz: string,
): number {
  let hour = GRID_START_HOUR;
  for (const iso of sessionStartsIso) {
    const min = minutesIntoDayInZone(iso, tz);
    if (min === null) continue;
    hour = Math.min(hour, Math.floor(min / 60));
  }
  for (const hhmm of breakStartHHMM) {
    const h = Number(hhmm.slice(0, 2));
    if (Number.isFinite(h)) hour = Math.min(hour, h);
  }
  return Math.max(0, hour);
}

/**
 * Vertical extent for one day: the 20:00 floor, grown to cover the latest block
 * or break and rounded up to a whole hour, clamped at midnight.
 *
 * Deliberately NOT `computeGridEndSlot` — that one hardcodes GRID_START_HOUR as
 * the axis origin, which is wrong for any derived `startHour`. The two agree
 * exactly when startHour is 8 (a test pins that), so don't "deduplicate" them.
 */
export function dayEndSlot(startHour: number, endSlots: ReadonlyArray<number>): number {
  const floor = Math.max(0, (DEFAULT_GRID_END_HOUR - startHour) * SLOTS_PER_HOUR);
  const needed = Math.max(floor, ...endSlots, 0);
  const wholeHours = Math.ceil(needed / SLOTS_PER_HOUR) * SLOTS_PER_HOUR;
  return Math.min(wholeHours, (24 - startHour) * SLOTS_PER_HOUR);
}
