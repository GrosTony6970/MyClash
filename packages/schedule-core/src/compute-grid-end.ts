/**
 * Dynamic vertical extent for the schedule board: the visible axis floors at
 * DEFAULT_GRID_END_HOUR but grows to cover the configured day-end and any
 * block/break that runs later, rounded up to the next whole hour and clamped
 * to midnight. Returned as a slot index (08:00 = 0).
 *
 * Pure: no React, no I/O.
 */
import {
  DEFAULT_GRID_END_HOUR,
  DEFAULT_GRID_START_HOUR,
  SLOT_MINUTES,
  hhmmToSlot,
} from './schedule-grid-geometry';

const SLOTS_PER_HOUR = 60 / SLOT_MINUTES; // 12

/**
 * `startHour` is the axis origin — now derived per day (see
 * `compute-grid-start.ts`), so every slot here is measured from it. Passing
 * the default keeps the historical 08:00–20:00 floor.
 */
export function computeGridEndSlot(input: {
  blockEndSlots: number[];
  breakEndSlots: number[];
  dayEndHHMM: string | null;
  startHour?: number;
}): number {
  const startHour = input.startHour ?? DEFAULT_GRID_START_HOUR;
  const defaultEndSlot = ((DEFAULT_GRID_END_HOUR - startHour) * 60) / SLOT_MINUTES;
  const midnightSlot = ((24 - startHour) * 60) / SLOT_MINUTES;
  const dayEndSlot = input.dayEndHHMM ? hhmmToSlot(input.dayEndHHMM, startHour) : 0;
  const raw = Math.max(defaultEndSlot, dayEndSlot, ...input.blockEndSlots, ...input.breakEndSlots);
  const rounded = Math.ceil(raw / SLOTS_PER_HOUR) * SLOTS_PER_HOUR;
  return Math.min(rounded, midnightSlot);
}
