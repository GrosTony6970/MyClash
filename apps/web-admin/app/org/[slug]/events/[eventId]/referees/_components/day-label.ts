import { localeToBcp47, type AppLocale } from '@myclash/time';

/**
 * Short day label for the by-timeslot header + day-filter pills. A pill's value is a bare
 * date, midnight UTC once parsed: read in UTC, or a browser west of UTC shows the day before.
 */
export function formatDayShort(value: string, locale: AppLocale, timeZone?: string) {
  return new Intl.DateTimeFormat(localeToBcp47(locale), {
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    timeZone,
  }).format(new Date(value));
}

/** The by-timeslot header: the slot's day and hour on the Event's clock, never the computer's. */
export function slotHeading(iso: string, locale: AppLocale, eventTz: string): string {
  const hour = new Intl.DateTimeFormat(localeToBcp47(locale), {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: eventTz,
  }).format(new Date(iso));
  return `${formatDayShort(iso, locale, eventTz)} · ${hour}`;
}
