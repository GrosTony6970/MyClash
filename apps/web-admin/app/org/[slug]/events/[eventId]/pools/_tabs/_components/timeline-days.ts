/**
 * The Event timeline's rows, grouped by Event day.
 *
 * Timeslot rows (concurrent units) and programme bars (break, admin,
 * workshop) are merged into one list ordered by their start instant, then cut
 * into days. The day is read on the EVENT's clock (`tz`): a 00:30 Paris bar
 * belongs to its own Paris day even though its UTC instant is the evening
 * before.
 *
 * Pure: no React, no DOM.
 */

import { zonedDay } from '@myclash/time';
import type { TimeslotBlock } from '../../../referees/_components/group-pools-by-timeslot';

export type TimelineRow<
  P extends { scheduledStart: string | null },
  B extends { startIso: string },
> =
  | { kind: 'slot'; startIso: string; block: TimeslotBlock<P> }
  | { kind: 'break'; startIso: string; brk: B };

export interface TimelineDayGroup<
  P extends { scheduledStart: string | null },
  B extends { startIso: string },
> {
  /** `YYYY-MM-DD` on the Event's clock. */
  day: string;
  rows: TimelineRow<P, B>[];
}

export function buildTimelineDays<
  P extends { scheduledStart: string | null },
  B extends { startIso: string },
>(blocks: TimeslotBlock<P>[], breaks: B[], tz: string): TimelineDayGroup<P, B>[] {
  const rows: TimelineRow<P, B>[] = [
    ...blocks.map((block) => ({ kind: 'slot' as const, startIso: block.startTime, block })),
    ...breaks.map((brk) => ({ kind: 'break' as const, startIso: brk.startIso, brk })),
  ].sort((a, b) => Date.parse(a.startIso) - Date.parse(b.startIso));

  const days: TimelineDayGroup<P, B>[] = [];
  for (const row of rows) {
    // An unreadable instant (a bad zone) groups under '' — an unnamed day —
    // rather than vanishing from the timeline.
    const day = zonedDay(row.startIso, tz) ?? '';
    const last = days[days.length - 1];
    if (last && last.day === day) last.rows.push(row);
    else days.push({ day, rows: [row] });
  }
  return days;
}
