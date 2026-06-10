import type { ProgrammeBlock } from '@myclash/types';

/**
 * Client-side time layout for the Configure-schedule drawer. The
 * server-side `programme.service.ts` lays blocks out on "Generate
 * schedule"; these mirror the same `HH:MM`↔minutes math so adding a block
 * or reordering can keep the times correct without a round-trip.
 */

export function timeToMin(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

export function minToTime(min: number): string {
  const clamped = Math.max(0, Math.min(min, 23 * 60 + 59));
  return `${String(Math.floor(clamped / 60)).padStart(2, '0')}:${String(clamped % 60).padStart(2, '0')}`;
}

/**
 * Start time for a new block appended to `dayIndex`: right after the day's
 * last block ends, or the day start when the day is empty.
 */
export function nextBlockStartTime(
  blocks: ProgrammeBlock[],
  dayIndex: number,
  dayStartTime: string,
): string {
  const day = blocks.filter((b) => b.dayIndex === dayIndex);
  const last = day[day.length - 1];
  return last ? last.endTime : dayStartTime;
}

/**
 * Re-flow one day's blocks (in their current array order) so they run
 * back-to-back, preserving each block's duration, anchored at the day's
 * earliest start (fallback `dayStartTime`). Blocks on other days are left
 * untouched; the array length + order are preserved.
 */
export function resequenceDay(
  blocks: ProgrammeBlock[],
  dayIndex: number,
  dayStartTime: string,
): ProgrammeBlock[] {
  const day = blocks.filter((b) => b.dayIndex === dayIndex);
  if (day.length === 0) return blocks;

  let cursor = Math.min(...day.map((b) => timeToMin(b.startTime)));
  if (!Number.isFinite(cursor)) cursor = timeToMin(dayStartTime);

  const next = new Map<string, { startTime: string; endTime: string }>();
  for (const b of day) {
    const duration = Math.max(0, timeToMin(b.endTime) - timeToMin(b.startTime));
    next.set(b.id, { startTime: minToTime(cursor), endTime: minToTime(cursor + duration) });
    cursor += duration;
  }

  return blocks.map((b) => {
    const t = next.get(b.id);
    return t ? { ...b, ...t } : b;
  });
}
