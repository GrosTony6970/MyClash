/**
 * Format an event's start_date / end_date pair into a single human
 * label. Returns null when either date is missing or unparseable so
 * the caller can fall back to a placeholder.
 *
 * Same shape as the previous inline helper in app/page.tsx — extracted
 * to a util so the new client-side EventsListSections + the existing
 * server page can both call it without duplication.
 */
/**
 * Parse a date-only string (`YYYY-MM-DD`, the events.start_date/end_date
 * storage shape) as LOCAL noon. `new Date('2026-03-01')` parses as UTC
 * midnight, so a viewer west of UTC saw "Feb 28" for a Mar 1 event.
 * Non date-only strings fall through to the native parser.
 */
import { type Locale } from '@myclash/i18n';
import { localeToBcp47 } from '@myclash/time';

function parseWallClockDate(value: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return new Date(value);
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12);
}

export function formatDateRange(
  event: {
    start_date?: string | null;
    end_date?: string | null;
  },
  locale: Locale,
): string | null {
  if (!event.start_date || !event.end_date) return null;
  const start = parseWallClockDate(event.start_date);
  const end = parseWallClockDate(event.end_date);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;

  const tag = localeToBcp47(locale);
  const monthDay: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' };
  if (start.getFullYear() !== end.getFullYear()) {
    return `${start.toLocaleDateString(tag, { ...monthDay, year: 'numeric' })} - ${end.toLocaleDateString(tag, { ...monthDay, year: 'numeric' })}`;
  }
  if (start.toDateString() === end.toDateString()) {
    return start.toLocaleDateString(tag, { ...monthDay, year: 'numeric' });
  }
  return `${start.toLocaleDateString(tag, monthDay)} - ${end.toLocaleDateString(tag, { ...monthDay, year: 'numeric' })}`;
}
