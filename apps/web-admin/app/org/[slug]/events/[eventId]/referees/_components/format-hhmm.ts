import { localeToBcp47, type AppLocale } from '@myclash/time';

/**
 * A wall-clock time for a referee-board list row, or an em-dash.
 *
 * Deliberately not `formatInZone`: these rows sit beside cards that already
 * carry the event's timezone in their header, and the two tabs that used to own
 * a private copy of this both rendered in the viewer's locale.
 */
export function formatHHMM(iso: string | null, locale: AppLocale): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleTimeString(localeToBcp47(locale), { hour: '2-digit', minute: '2-digit' });
}
