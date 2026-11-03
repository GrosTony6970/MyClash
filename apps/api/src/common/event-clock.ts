import { BadRequestException, NotFoundException, type Logger } from '@nestjs/common';
import type { SupabaseClient } from '@supabase/supabase-js';
import { addDays, DEFAULT_EVENT_TIMEZONE, isIanaZone, zonedToUtcIso } from '@myclash/time';

/**
 * An Event's clock: its first day and the zone its wall-clock times are read in. The one owner
 * of that read and of turning a programme bar's day and "HH:MM" into an instant (ruling 414).
 * The programme lays, moves and clears bouts with it; the next-bout end reads its bars with it;
 * the live board picks its day and bar with `eventZone` (`boardClock`).
 */

/**
 * The zone an Event's wall-clock times are read in.
 *
 * A stored value that is not an IANA name reads in `DEFAULT_EVENT_TIMEZONE`, the fallback every
 * API reader uses, and says so through `unknownZone`. Luxon is not the check: it reads
 * `undefined`, `null`, `'local'` and `'system'` as the SERVER's zone.
 */
export function eventZone(timezone: unknown): { zone: string; unknownZone: boolean } {
  const zone = isIanaZone(timezone) ? (timezone as string) : DEFAULT_EVENT_TIMEZONE;
  return { zone, unknownZone: zone !== timezone };
}

/** The warning for an unknown zone. The zone is quoted: an organiser typed it. */
export function unknownZoneWarning(eventId: string, timezone: unknown): string {
  return `Event ${eventId}: unknown time zone ${JSON.stringify(timezone)}; days read in ${DEFAULT_EVENT_TIMEZONE}`;
}

export interface EventClock {
  /** `YYYY-MM-DD`: day index 0 of the programme. */
  firstDay: string;
  zone: string;
}

/**
 * The Event's first day and zone, warning on `logger` when the stored zone is unknown.
 * 400 on a read error or a first day that is not a date; 404 when there is no such Event.
 */
export async function readEventClock(
  db: SupabaseClient,
  eventId: string,
  logger: Pick<Logger, 'warn'>,
): Promise<EventClock> {
  const { data, error } = await db
    .from('events')
    .select('start_date, timezone')
    .eq('id', eventId)
    .maybeSingle();
  if (error) throw new BadRequestException(error.message);
  const row = data as { start_date: string | null; timezone: unknown } | null;
  if (!row) throw new NotFoundException('Event not found');
  const firstDay = addDays(row.start_date?.slice(0, 10), 0);
  if (!firstDay) {
    throw new BadRequestException(`Event ${eventId} starts on "${row.start_date}", not a day`);
  }
  const { zone, unknownZone } = eventZone(row.timezone);
  if (unknownZone) logger.warn(unknownZoneWarning(eventId, row.timezone));
  return { firstDay, zone };
}

/** The calendar day of programme day `dayIndex`. A DST change moves the clock, never the date. */
export function barDay(firstDay: string, dayIndex: number): string | null {
  return addDays(firstDay, dayIndex);
}

/**
 * The instant of minute `minuteOfDay` of `day` on `zone`'s wall clock. A minute past midnight
 * (a day's run that went late) lands on the next day's clock, as the old `setHours(25, …)` did.
 * Null on a bad day or a negative minute.
 */
export function barInstant(day: string, minuteOfDay: number, zone: string): string | null {
  const onDay = addDays(day, Math.floor(minuteOfDay / 1440));
  const minute = minuteOfDay % 1440;
  const hhmm = `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
  return zonedToUtcIso(onDay, hhmm, zone);
}
