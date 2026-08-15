/**
 * Map an event's programme blocks onto the grid axis for one day.
 *
 * Extracted from grid.tsx because the bug lived here and was untestable
 * inline: the mapping used to end with `.filter(b => b.startSlot < TOTAL_SLOTS)`,
 * which dropped every block starting at or after 20:00 from BOTH views. It also
 * defeated itself — the axis end is computed FROM this list, so a 20:30 bar was
 * removed before it could widen the axis that would have shown it. An evening
 * final vanished from the board entirely.
 *
 * Nothing is filtered here now. Blocks outside the visible axis are the axis's
 * problem, not the list's.
 *
 * Pure: no React, no I/O.
 */
import { SLOT_MINUTES } from '@myclash/schedule-core';

export interface DayBlockInput {
  dayIndex: number;
  /** Wall-clock `HH:MM` (or `HH:MM:SS` as Postgres returns a `TIME`). */
  startTime: string;
  endTime: string;
}

export interface BlockSlots {
  startSlot: number;
  /** Slot count, always at least 1 so a zero-length block still renders. */
  span: number;
}

/** Minutes since midnight for `HH:MM`, tolerating the `HH:MM:SS` Postgres form. */
export function hhmmToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map((s) => Number(s));
  return (h ?? 0) * 60 + (m ?? 0);
}

/**
 * The exact inverse: `HH:MM` for minutes since midnight.
 *
 * Lives beside `hhmmToMinutes` so the pair cannot drift. Not a slot conversion
 * — the axis origin is nowhere in it, which is what the whole-day delay needs:
 * a wall-clock time to cut the day at, not a row on the grid.
 */
export function minutesToHHMM(min: number): string {
  const wrapped = Math.max(0, Math.min(Math.floor(min), 24 * 60 - 1));
  return `${String(Math.floor(wrapped / 60)).padStart(2, '0')}:${String(wrapped % 60).padStart(2, '0')}`;
}

/** Slot indices for one block on an axis starting at `startHour`. */
export function blockSlots(block: DayBlockInput, startHour: number): BlockSlots {
  const originMin = startHour * 60;
  const startSlot = Math.max(
    0,
    Math.floor((hhmmToMinutes(block.startTime) - originMin) / SLOT_MINUTES),
  );
  const endSlot = Math.max(
    startSlot + 1,
    Math.ceil((hhmmToMinutes(block.endTime) - originMin) / SLOT_MINUTES),
  );
  return { startSlot, span: endSlot - startSlot };
}

/**
 * Every programme block on `dayIndex`, with its axis geometry attached and in
 * the order given. No block is dropped — see the note above.
 */
export function programmeBlocksForDay<T extends DayBlockInput>(
  blocks: readonly T[],
  dayIndex: number,
  startHour: number,
): Array<T & BlockSlots> {
  return blocks
    .filter((b) => b.dayIndex === dayIndex)
    .map((b) => ({ ...b, ...blockSlots(b, startHour) }));
}
