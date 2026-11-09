// Pure day-grouping for workshop catalogs — shared by the public workshops page
// and the personal-space workshops tab. Framework-free (no JSX, no i18n) so the
// ordering can be unit-tested without rendering a card.

import { zonedDay } from '@myclash/time';

export interface WorkshopListItem {
  id: string;
  slug: string;
  title: string;
  shortDescription: string | null;
  descriptionMd: string | null;
  category: string | null;
  level: string | null;
  weapon: string | null;
  language: string | null;
  color: string | null;
  coverImageUrl: string | null;
  capacity: number | null;
  durationMinutes: number | null;
  sessions: Array<{
    id: string;
    startsAt: string | null;
    endsAt: string | null;
    locationLabel: string | null;
    venue: { name: string } | null;
    area: { name: string } | null;
    capacity: number | null;
    confirmedCount: number;
    status?: string | null;
  }>;
  instructors: Array<{ globalPersonId: string | null; displayName: string }>;
}

/** Earliest scheduled session ISO for a workshop, or null when unscheduled. */
export function firstSessionStart(w: WorkshopListItem): string | null {
  const dated = w.sessions
    .map((s) => s.startsAt)
    .filter((v): v is string => Boolean(v))
    .sort();
  return dated[0] ?? null;
}

export const WORKSHOP_UNSCHEDULED = '__unscheduled__';

type Session = WorkshopListItem['sessions'][number];

/**
 * The dated sessions that place a Workshop on a day: every one, a cancelled one included. A
 * cancelled session stays on the day it was announced for, struck through (ruling 526).
 */
function placingSessions(w: WorkshopListItem): Session[] {
  return w.sessions.filter((s) => s.startsAt);
}

/** The days a Workshop runs on (event tz), or the unscheduled key alone. */
export function workshopDayKeys(w: WorkshopListItem, tz: string): string[] {
  const keys = placingSessions(w).map((s) => zonedDay(s.startsAt, tz) ?? WORKSHOP_UNSCHEDULED);
  return keys.length > 0 ? [...new Set(keys)] : [WORKSHOP_UNSCHEDULED];
}

export interface WorkshopDayGroup {
  key: string;
  repIso: string | null;
  items: WorkshopListItem[];
}

/** Group workshops by day (event tz); scheduled days ascending, the unscheduled
 *  bucket last, and — within each day — workshops in session order rather than
 *  the admin `sort_order` the API returns them in. A Workshop runs several
 *  sessions (ruling 515): it is listed under EACH day it runs, carrying that
 *  day's sessions only, so a card shows that day's times and buttons. Shared by
 *  the public catalog and the personal-space workshops tab. */
export function groupWorkshopsByDay(list: WorkshopListItem[], tz: string): WorkshopDayGroup[] {
  const byDay = new Map<string, WorkshopListItem[]>();
  const repByDay = new Map<string, string>();
  const add = (key: string, item: WorkshopListItem) => {
    byDay.set(key, [...(byDay.get(key) ?? []), item]);
    const start = firstSessionStart(item);
    const existing = repByDay.get(key);
    if (start && (!existing || start < existing)) repByDay.set(key, start);
  };
  for (const w of list) {
    const placing = placingSessions(w);
    if (placing.length === 0) {
      add(WORKSHOP_UNSCHEDULED, w);
      continue;
    }
    for (const key of workshopDayKeys(w, tz)) {
      const sessions = placing.filter((s) => zonedDay(s.startsAt, tz) === key);
      add(key, { ...w, sessions });
    }
  }
  const keys = [...byDay.keys()].filter((k) => k !== WORKSHOP_UNSCHEDULED).sort();
  if (byDay.has(WORKSHOP_UNSCHEDULED)) keys.push(WORKSHOP_UNSCHEDULED);
  return keys.map((key) => ({
    key,
    repIso: repByDay.get(key) ?? null,
    items: sortByStart(byDay.get(key)!),
  }));
}

/** Session start ascending; undated last, then title so the order is stable. */
function sortByStart(items: WorkshopListItem[]): WorkshopListItem[] {
  return items
    .map((w) => ({ w, start: firstSessionStart(w) }))
    .sort((a, b) => {
      if (a.start !== b.start) {
        if (!a.start) return 1;
        if (!b.start) return -1;
        return a.start.localeCompare(b.start);
      }
      return a.w.title.localeCompare(b.w.title);
    })
    .map(({ w }) => w);
}
