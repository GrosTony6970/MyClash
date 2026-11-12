'use client';

import { useI18n } from '@myclash/next-i18n/client';

/** A day as the reader's language writes it. The day is a date, not an instant: read in UTC. */
export function useDayLabel(): (day: string) => string {
  const { locale } = useI18n();
  return (day) =>
    new Intl.DateTimeFormat(locale, {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      timeZone: 'UTC',
    }).format(new Date(`${day}T00:00:00Z`));
}
