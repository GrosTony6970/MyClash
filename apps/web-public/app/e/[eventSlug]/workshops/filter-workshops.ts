// The public Workshop catalogue's filters (slice 3.6 adds the weapon and the instructor): which
// choices each drop-down offers, and which Workshops a set of choices keeps.

import { fuzzyMatch } from '@myclash/ui';
import {
  groupWorkshopsByDay,
  WORKSHOP_UNSCHEDULED,
  workshopDayKeys,
  type WorkshopListItem,
} from '@/components/workshops/workshop-grouping';

export interface WorkshopFilters {
  query: string;
  day: string;
  category: string;
  level: string;
  language: string;
  weapon: string;
  instructor: string;
}

export const NO_FILTERS: WorkshopFilters = {
  query: '',
  day: '',
  category: '',
  level: '',
  language: '',
  weapon: '',
  instructor: '',
};

export interface FilterOption {
  value: string;
  label: string;
}

type Instructor = WorkshopListItem['instructors'][number];

/** An instructor's choice in the filter: their profile, else their name (a line with no profile). */
export const instructorKey = (i: Instructor): string => i.globalPersonId ?? `name:${i.displayName}`;

const distinct = (values: Array<string | null>): string[] => [
  ...new Set(values.filter((v): v is string => Boolean(v))),
];

/** Each drop-down's choices: only what the Event's Workshops use. Weapons and people by name. */
export function filterOptions(rows: WorkshopListItem[], timezone: string) {
  const people = new Map<string, string>();
  for (const i of rows.flatMap((w) => w.instructors)) {
    if (!people.has(instructorKey(i))) people.set(instructorKey(i), i.displayName);
  }
  return {
    // Every day a Workshop runs, from the grouping the cards are drawn with (ruling 515).
    days: groupWorkshopsByDay(rows, timezone)
      .filter((g) => g.key !== WORKSHOP_UNSCHEDULED && g.repIso)
      .map((g) => ({ key: g.key, repIso: g.repIso! })),
    categories: distinct(rows.map((w) => w.category)),
    levels: distinct(rows.map((w) => w.level)),
    languages: distinct(rows.map((w) => w.language)),
    weapons: distinct(rows.map((w) => w.weapon)).sort((a, b) => a.localeCompare(b)),
    instructors: [...people]
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label)),
  };
}

/** The Workshops every choice keeps; the search matches the title or any instructor's name. */
export function filterWorkshops(
  rows: WorkshopListItem[],
  f: WorkshopFilters,
  timezone: string,
): WorkshopListItem[] {
  return rows.filter((w) => {
    if (f.day && !workshopDayKeys(w, timezone).includes(f.day)) return false;
    if (f.category && w.category !== f.category) return false;
    if (f.level && w.level !== f.level) return false;
    if (f.language && w.language !== f.language) return false;
    if (f.weapon && w.weapon !== f.weapon) return false;
    if (f.instructor && !w.instructors.some((i) => instructorKey(i) === f.instructor)) return false;
    return fuzzyMatch(f.query, [w.title, ...w.instructors.map((i) => i.displayName)].join(' '));
  });
}
