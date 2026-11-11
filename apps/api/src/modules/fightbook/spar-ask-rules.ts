import { addDays, dayStartUtcIso } from '@myclash/time';
import type { SparKind } from '@myclash/types';
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
