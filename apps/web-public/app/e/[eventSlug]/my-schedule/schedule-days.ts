import { formatDate, zonedDay, type AppLocale } from '@myclash/time';

/**
 * The days of the guest schedule: ONE rule for the chips, the filter behind
 * them and the headings.
 *
 * They were three. The chips and the headings took the day on the Event's
 * clock, and the filter compared the UTC text of the time. A bout at 00:30
 * local time then had a chip of its own that showed nothing when tapped.
 */

/** The calendar day (`YYYY-MM-DD`) an instant falls on, on the Event's clock. */
export function eventDay(iso: string, tz: string): string {
  return zonedDay(iso, tz) ?? iso.slice(0, 10);
}

/** Each day that holds an item, once, in order. An item with no time has no day. */
export function eventDays(items: Array<{ time: string | null }>, tz: string): string[] {
  const days = items.flatMap((item) => (item.time ? [eventDay(item.time, tz)] : []));
  return [...new Set(days)].sort();
}

/** The items under one chip: all of them for "all", else those of that day. */
export function onEventDay<T extends { time: string | null }>(
  items: T[],
  day: string,
  tz: string,
): T[] {
  if (day === 'all') return items;
  return items.filter((item) => item.time !== null && eventDay(item.time, tz) === day);
}

// A day key is a date, not an instant. It is formatted in UTC, where the key
// was written: in the phone's zone, a phone west of UTC showed the day before.

/** The chip's words for a day key: "Sun 14". */
export function dayChipLabel(day: string, locale: AppLocale): string {
  return formatDate(day, locale, { weekday: 'short', day: 'numeric' }, 'UTC');
}

/** The heading's words for a day key: "Sunday 14 March". */
export function dayHeading(day: string, locale: AppLocale): string {
  return formatDate(day, locale, { weekday: 'long', day: 'numeric', month: 'long' }, 'UTC');
}
