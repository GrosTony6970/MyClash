/**
 * Which programme block is running right now.
 *
 * Extracted from LiveStateService so the live control room can read the same
 * answer without duplicating the rule. Pure: the caller fetches the blocks and
 * supplies the clock. No I/O, no Nest.
 */

/**
 * Planned length of one bout, used as the drift and overrun basis when no
 * programme block covers "now".
 *
 * Not an invented number: `event_programme_blocks.match_duration_minutes`
 * defaults to 5 (migration 0028), `schedule-grid.service.ts` hardcodes 5 for
 * its cards, and the grid's SLOT_MINUTES is 5. Three places already agreed on
 * it; this names it once.
 */
export const DEFAULT_MATCH_DURATION_MINUTES = 5;

/** The shape `selectProgrammeBlocks` needs — a subset of ProgrammeBlock. */
export interface BlockWindow {
  startTime: string;
  endTime: string;
}

/**
 * Which day of the event `nowMs` falls on, as a 0-based index from the event's
 * start date. Out-of-range dates clamp to day 0 rather than going negative:
 * an unparseable or future start date should show the first day's programme,
 * not none of it.
 */
export function dayIndexFor(startDate: string | null | undefined, nowMs: number): number {
  const start = new Date(startDate ?? '');
  if (isNaN(start.getTime())) return 0;
  return Math.max(0, Math.floor((nowMs - start.getTime()) / (24 * 60 * 60 * 1000)));
}

/**
 * Split a day's blocks into the one covering `nowHHMM` and the next one due.
 *
 * `nowHHMM` is a local-clock "HH:MM" and the comparison is a string compare,
 * which works because both sides are zero-padded 24h. That the clock is the
 * SERVER's local time is a pre-existing property of this rule, deliberately
 * preserved here — moving it would change /live-state's output for every
 * deployment whose container is not on venue time, which is a decision, not a
 * refactor.
 *
 * Blocks are expected in `sort_order`; `next` is the first block starting after
 * now, so an unsorted input yields an arbitrary-but-valid pick.
 */
export function selectProgrammeBlocks<T extends BlockWindow>(
  blocks: readonly T[],
  nowHHMM: string,
): { current: T | null; next: T | null } {
  let current: T | null = null;
  let next: T | null = null;
  for (const block of blocks) {
    const start = block.startTime.slice(0, 5);
    const end = block.endTime.slice(0, 5);
    if (start <= nowHHMM && nowHHMM <= end) {
      current = block;
    } else if (start > nowHHMM && !next) {
      next = block;
    }
  }
  return { current, next };
}

/** Local-clock "HH:MM" for a Date, the format `selectProgrammeBlocks` compares. */
export function toHHMM(now: Date): string {
  return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
}
