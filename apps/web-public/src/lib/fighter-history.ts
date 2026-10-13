import { formatDate, type AppLocale } from '@myclash/time';
import { boutPageHref } from './bout-page';

/**
 * Where a line of a fighter's bouts leads (quick win F21): the bout's page,
 * with the fighter's page as its way back. The ONE builder for the fighter's
 * page: the full history, the recent results and the bout in play. Null when
 * the line has no Event address: there is no page to open.
 */
export function historyBoutHref(
  line: { id: string; eventSlug?: string | null },
  fighterSlug: string,
): string | null {
  return line.eventSlug ? boutPageHref(line.eventSlug, line.id, `/fighters/${fighterSlug}`) : null;
}

/**
 * The day a history line shows: the first day of the bout's Event, a plain day
 * (`2026-03-14`). It is read and worded in UTC, so it cannot slip to the day
 * before for a visitor west of Greenwich. Empty when the Event has no day.
 */
export function historyDay(eventDate: string, locale: AppLocale): string {
  return formatDate(eventDate, locale, undefined, 'UTC');
}
