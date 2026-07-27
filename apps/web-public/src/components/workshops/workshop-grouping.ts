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

export interface WorkshopDayGroup {
  key: string;
  repIso: string | null;
  items: WorkshopListItem[];
}

/** Group workshops by their earliest session's day (event tz); scheduled days
 *  ascending, the unscheduled bucket last, and — within each day — workshops in
 *  session order rather than the admin `sort_order` the API returns them in.
 *  Shared by the public catalog and the personal-space workshops tab. */
export function groupWorkshopsByDay(list: WorkshopListItem[], tz: string): WorkshopDayGroup[] {
  const byDay = new Map<string, WorkshopListItem[]>();
  const repByDay = new Map<string, string>();
  for (const w of list) {
    const start = firstSessionStart(w);
    const key = zonedDay(start, tz) ?? WORKSHOP_UNSCHEDULED;
    const arr = byDay.get(key) ?? [];
    arr.push(w);
    byDay.set(key, arr);
    if (start) {
      const existing = repByDay.get(key);
      if (!existing || start < existing) repByDay.set(key, start);
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
