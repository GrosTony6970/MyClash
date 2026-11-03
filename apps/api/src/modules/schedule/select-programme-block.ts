/**
 * Which programme block is running right now.
 *
 * Read by LiveStateService (the live board). The caller fetches the blocks and
 * supplies the clock. No I/O; calls no Nest; reads the zone through `eventZone`
 * (`common/event-clock.ts`).
 */

import { dayIndexInZone, utcToZonedParts } from '@myclash/time';
import { eventZone } from '../../common/event-clock';

/** The shape `selectProgrammeBlocks` needs — a subset of ProgrammeBlock. */
export interface BlockWindow {
  startTime: string;
  endTime: string;
}

/**
 * Where `nowIso` falls on the Event's wall clock (ruling 411): the programme day, 0-based from
 * `firstDay` and counted in the Event's calendar days, and the "HH:MM" `selectProgrammeBlocks`
 * compares. `timezone` is the stored one: `eventZone` reads an unknown one in the default zone and
 * says so through `unknownZone`, for the caller to log (this module has no logger).
 *
 * A day before `firstDay` is day 0: the board shows the first day's programme rather than none.
 * So is a missing `firstDay`, and `unknownFirstDay` says so. The column is DATE NOT NULL (0223):
 * only a lost projection gets here.
 */
export function boardClock(
  nowIso: string,
  firstDay: string | null | undefined,
  timezone: unknown,
): {
  dayIndex: number;
  hhmm: string;
  zone: string;
  unknownZone: boolean;
  unknownFirstDay: boolean;
} {
  const { zone, unknownZone } = eventZone(timezone);
  const dayIndex = dayIndexInZone(nowIso, firstDay?.slice(0, 10), zone);
  return {
    dayIndex: dayIndex ?? 0,
    // Null only on an invalid instant or zone: `nowIso` comes from a Date, `zone` from eventZone.
    hhmm: utcToZonedParts(nowIso, zone)!.hhmm,
    zone,
    unknownZone,
    unknownFirstDay: dayIndex === null,
  };
}

/**
 * Split a day's blocks into the one covering `nowHHMM` and the next one due.
 *
 * `nowHHMM` is the Event's wall clock, from `boardClock`, and the comparison is
 * a string compare, which works because both sides are zero-padded 24h.
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
