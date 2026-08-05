/**
 * Header filters + sort values for the event Workshops admin list.
 *
 * The list is fetched whole (no server paging), so every predicate here runs
 * client-side inside the page's memo chain: fuzzy search on the Name header,
 * then the Category / Level / Venue dropdowns, then `sortRows`.
 *
 * Category and level are free text — the create form stores whatever the
 * organiser typed — so the dropdown options are derived from the loaded rows
 * rather than an enum. Same approach as the public browser
 * (apps/web-public/.../WorkshopsBrowser.tsx).
 *
 * Row parameters are structural on purpose: the page owns the `Workshop`
 * interface, this module only names the fields it reads.
 */

/** Venue of record for a workshop: the scheduled session's, else the workshop default. */
export interface WorkshopVenueSource {
  venueId: string | null;
  venue: { id: string; name: string } | null;
  sessions: ReadonlyArray<{
    venueId: string | null;
    venue: { id: string; name: string } | null;
  }>;
}

export interface WorkshopFilterRow extends WorkshopVenueSource {
  title: string;
  category: string | null;
  level: string | null;
  instructors: ReadonlyArray<{ displayName: string }>;
}

export interface WorkshopFilterValue {
  /** '' = all. Free-text category, matched exactly as stored. */
  category: string;
  /** '' = all. Free-text level, matched exactly as stored. */
  level: string;
  /** '' = all, NO_VENUE = neither the session nor the workshop names a venue, else a venueId. */
  venue: string;
}

/** Sentinel for the "no venue" option — no venue id can collide with it (ids are UUIDs). */
export const NO_VENUE = 'none';

export const EMPTY_WORKSHOP_FILTER: WorkshopFilterValue = { category: '', level: '', venue: '' };

export function isWorkshopFilterActive(filter: WorkshopFilterValue, query: string): boolean {
  return (
    query.trim() !== '' || filter.category !== '' || filter.level !== '' || filter.venue !== ''
  );
}

/** Title + every instructor name, so a search hits either. */
export function workshopSearchHaystack(row: {
  title: string;
  instructors: ReadonlyArray<{ displayName: string }>;
}): string {
  return [row.title, ...row.instructors.map((i) => i.displayName)].join(' ');
}

/**
 * The venue the row actually displays: a scheduled session overrides the
 * workshop-level default (sessions inherit it, but the operator can repoint
 * a session at another venue).
 */
export function effectiveVenue(row: WorkshopVenueSource): { id: string; name: string } | null {
  const session = row.sessions[0] ?? null;
  if (session?.venue) return session.venue;
  if (session?.venueId) return { id: session.venueId, name: session.venueId };
  if (row.venue) return row.venue;
  if (row.venueId) return { id: row.venueId, name: row.venueId };
  return null;
}

/** Dropdown predicates only — the fuzzy query is applied by the caller. */
export function workshopMatchesFilter(
  row: WorkshopFilterRow,
  filter: WorkshopFilterValue,
): boolean {
  if (filter.category !== '' && (row.category ?? '') !== filter.category) return false;
  if (filter.level !== '' && (row.level ?? '') !== filter.level) return false;
  if (filter.venue !== '') {
    const venue = effectiveVenue(row);
    if (filter.venue === NO_VENUE ? venue !== null : venue?.id !== filter.venue) return false;
  }
  return true;
}

export interface WorkshopFilterOptions {
  categories: string[];
  levels: string[];
  venues: Array<{ id: string; name: string }>;
  /** At least one workshop has no venue at all — drives the "No venue" option. */
  hasUnvenued: boolean;
}

function distinctSorted(values: ReadonlyArray<string | null>): string[] {
  return [...new Set(values.filter((v): v is string => Boolean(v && v.trim())))].sort((a, b) =>
    a.localeCompare(b),
  );
}

/** Options come from the loaded rows, so they can never filter down to nothing. */
export function deriveWorkshopFilterOptions(
  rows: ReadonlyArray<WorkshopFilterRow>,
): WorkshopFilterOptions {
  const venues = new Map<string, string>();
  let hasUnvenued = false;
  for (const row of rows) {
    const venue = effectiveVenue(row);
    if (venue) venues.set(venue.id, venue.name);
    else hasUnvenued = true;
  }
  return {
    categories: distinctSorted(rows.map((r) => r.category)),
    levels: distinctSorted(rows.map((r) => r.level)),
    venues: [...venues.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    hasUnvenued,
  };
}

export interface WorkshopSortRow extends WorkshopVenueSource {
  title: string;
  category: string | null;
  level: string | null;
  capacity: number | null;
  durationMinutes: number | null;
  status: string;
  sessions: ReadonlyArray<{
    startsAt: string | null;
    venueId: string | null;
    venue: { id: string; name: string } | null;
  }>;
}

/**
 * Column values for `sortRows`. Nulls sort last in both directions there, so
 * unscheduled / unfilled workshops sink whichever way the column points.
 * Start returns a Date: instants order correctly regardless of display zone.
 */
export function workshopSortValue(row: WorkshopSortRow, key: string): unknown {
  switch (key) {
    case 'name':
      return row.title;
    case 'category':
      return row.category;
    case 'level':
      return row.level;
    case 'capacity':
      return row.capacity;
    case 'duration':
      return row.durationMinutes;
    case 'start': {
      const startsAt = row.sessions[0]?.startsAt ?? null;
      return startsAt ? new Date(startsAt) : null;
    }
    case 'venue':
      return effectiveVenue(row)?.name ?? null;
    case 'status':
      return row.status;
    default:
      return null;
  }
}
