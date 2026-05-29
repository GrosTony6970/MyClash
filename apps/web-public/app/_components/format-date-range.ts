/**
 * Format an event's start_date / end_date pair into a single human
 * label. Returns null when either date is missing or unparseable so
 * the caller can fall back to a placeholder.
 *
 * Same shape as the previous inline helper in app/page.tsx — extracted
 * to a util so the new client-side EventsListSections + the existing
 * server page can both call it without duplication.
 */
export function formatDateRange(event: {
  start_date?: string | null;
  end_date?: string | null;
}): string | null {
  if (!event.start_date || !event.end_date) return null;
  const start = new Date(event.start_date);
  const end = new Date(event.end_date);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;

  const monthDay: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' };
  if (start.getFullYear() !== end.getFullYear()) {
    return `${start.toLocaleDateString(undefined, { ...monthDay, year: 'numeric' })} - ${end.toLocaleDateString(undefined, { ...monthDay, year: 'numeric' })}`;
  }
  if (start.toDateString() === end.toDateString()) {
    return start.toLocaleDateString(undefined, { ...monthDay, year: 'numeric' });
  }
  return `${start.toLocaleDateString(undefined, monthDay)} - ${end.toLocaleDateString(undefined, { ...monthDay, year: 'numeric' })}`;
}
