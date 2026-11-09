/**
 * When a Workshop session starts, as a notice says it: on the Event's clock, each language its own
 * way. The ONE wording of a session's time in the moved, cancelled and promoted notices.
 */
import { formatDateTime } from '@myclash/time';
import { eventZone } from '../../../common/event-clock';
import type { PerLanguage } from './notice-texts';

const WHEN: Intl.DateTimeFormatOptions = {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
};

/** Null when the session has no start. */
export function sessionWhen(
  startsAt: string | null | undefined,
  timezone: string | null | undefined,
): PerLanguage | null {
  if (!startsAt) return null;
  const { zone } = eventZone(timezone);
  return {
    fr: formatDateTime(startsAt, 'fr', WHEN, zone),
    en: formatDateTime(startsAt, 'en', WHEN, zone),
  };
}
