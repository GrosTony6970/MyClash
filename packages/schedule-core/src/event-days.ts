/**
 * Shared event-day helpers — used by the event schedule grid and the
 * workshop schedule board so day tabs render identically. Pure, UTC-based.
 */
import { zonedDay } from '@myclash/time';

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

/**
 * The day a planning board opens on (quick win O6, ruled 2026-10-14): today in the
 * Event's zone when today is one of `days`, else null and the board keeps its own default.
 * On day 2, nobody drops a Pool onto yesterday.
 */
export function initialDay(
  days: readonly string[],
  timeZone: string,
  nowIso: string,
): string | null {
  const today = zonedDay(nowIso, timeZone);
  return today && days.includes(today) ? today : null;
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
