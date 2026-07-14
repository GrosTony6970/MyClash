/**
 * Shared event-day helpers — used by the event schedule grid and the
 * workshop schedule board so day tabs render identically. Pure, UTC-based.
 */

/**
 * Return every ISO date (YYYY-MM-DD) between start and end inclusive.
 * Falls back to [start] when end is missing or earlier than start.
 */
export function eachDay(start: string, end: string | null | undefined): string[] {
  if (!start) return [];
  if (!end || end < start) return [start];
  const days: string[] = [];
  const startDate = new Date(`${start}T00:00:00Z`);
  const endDate = new Date(`${end}T00:00:00Z`);
  for (let d = new Date(startDate); d <= endDate; d.setUTCDate(d.getUTCDate() + 1)) {
    days.push(d.toISOString().slice(0, 10));
  }
  return days.length > 0 ? days : [start];
}

/** Day-of-week + DD MMM, French locale (the rest of the admin app is FR-leaning). */
export function formatDayLabel(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return d.toLocaleDateString('fr-FR', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    timeZone: 'UTC',
  });
}
