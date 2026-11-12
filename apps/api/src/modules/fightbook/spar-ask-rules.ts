import { addDays, dayStartUtcIso } from '@myclash/time';
import type { SparKind } from '@myclash/types';
import { eventZone } from '../../common/event-clock';
import { EVENT_CLOSING_HOUR } from '../../common/event-open-window';

/** How far ahead a spar may be asked for. */
export const SPAR_MAX_DAYS_AHEAD = 365;

const YMD = /^\d{4}-\d{2}-\d{2}$/;

/**
 * When a request for `day` ends unanswered: an Event day at 06:00 the next morning on the Event's
 * clock (ruling 154, the hour an Event day closes everywhere in MyClash), a free date at midnight
 * on the asker's clock. Null when `day` is not a date.
 */
export function sparExpiresAt(kind: SparKind, day: string, zone: string): Date | null {
  const nextDay = YMD.test(day) ? addDays(day, 1) : null;
  if (!nextDay) return null;
  const iso = dayStartUtcIso(nextDay, zone, kind === 'event' ? EVENT_CLOSING_HOUR : 0);
  return iso ? new Date(iso) : null;
}

/** No Event runs this long; the walk stops here if a stored end date is wrong. */
const MAX_EVENT_DAYS = 31;

/**
 * The days of an Event that have not ended on its own clock (a day ends at 06:00 the next
 * morning, as `sparExpiresAt`), and `today`: the latest open day whose midnight has passed, null
 * before the first day starts. Between 00:00 and 06:00 two days are open and started: the later
 * one is today. An unknown zone reads in the default one (`eventZone`).
 */
export function openEventDays(
  event: { start_date: string; end_date: string; timezone: unknown },
  now: Date,
): { days: string[]; today: string | null } {
  const { zone } = eventZone(event.timezone);
  const last = event.end_date.slice(0, 10);
  const days: string[] = [];
  let today: string | null = null;
  let day = addDays(event.start_date.slice(0, 10), 0);
  for (let n = 0; day && day <= last && n < MAX_EVENT_DAYS; n++) {
    const ends = sparExpiresAt('event', day, zone);
    const starts = dayStartUtcIso(day, zone);
    if (ends && ends.getTime() > now.getTime()) {
      days.push(day);
      if (starts && new Date(starts).getTime() <= now.getTime()) today = day;
    }
    day = addDays(day, 1);
  }
  return { days, today };
}

/** 'bad_day' unless `day` is a date between the Event's first and last day. */
export function eventDayRefusal(
  day: string,
  event: { start_date: string; end_date: string },
): 'bad_day' | null {
  if (!YMD.test(day)) return 'bad_day';
  return day >= event.start_date.slice(0, 10) && day <= event.end_date.slice(0, 10)
    ? null
    : 'bad_day';
}
