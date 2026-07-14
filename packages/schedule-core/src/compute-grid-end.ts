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
  GRID_START_HOUR,
  SLOT_MINUTES,
  hhmmToSlot,
} from './schedule-grid-geometry';

const DEFAULT_END_SLOT = ((DEFAULT_GRID_END_HOUR - GRID_START_HOUR) * 60) / SLOT_MINUTES; // 144
const SLOTS_PER_HOUR = 60 / SLOT_MINUTES; // 12
const MIDNIGHT_SLOT = ((24 - GRID_START_HOUR) * 60) / SLOT_MINUTES; // 192

export function computeGridEndSlot(input: {
  blockEndSlots: number[];
  breakEndSlots: number[];
  dayEndHHMM: string | null;
}): number {
  const dayEndSlot = input.dayEndHHMM ? hhmmToSlot(input.dayEndHHMM) : 0;
  const raw = Math.max(
    DEFAULT_END_SLOT,
    dayEndSlot,
    ...input.blockEndSlots,
    ...input.breakEndSlots,
  );
  const rounded = Math.ceil(raw / SLOTS_PER_HOUR) * SLOTS_PER_HOUR;
  return Math.min(rounded, MIDNIGHT_SLOT);
}
