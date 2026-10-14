import { formatInZone } from '@myclash/time';

/**
 * When a review was answered (O11, ruled 2026-10-14), on the Event's clock. The zone is always
 * named: while the Event is not known yet, the date is on the browser's clock, and says so.
 */
export function reviewedAt(iso: string | null, zone: string | undefined, locale: string): string {
  const clock = zone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  return formatInZone(
    iso,
    clock,
    {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZoneName: 'short',
    },
    locale,
  );
}
