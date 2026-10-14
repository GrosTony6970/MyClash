import { localeToBcp47, type AppLocale } from '@myclash/time';

/**
 * Short day label for the by-timeslot header + day-filter pills. A pill's value is a bare
 * date, midnight UTC once parsed: read in UTC, or a browser west of UTC shows the day before.
 */
export function formatDayShort(value: string, locale: AppLocale, timeZone?: 'UTC') {
  return new Intl.DateTimeFormat(localeToBcp47(locale), {
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    timeZone,
  }).format(new Date(value));
}
