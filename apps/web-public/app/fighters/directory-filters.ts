/**
 * Directory filter state, as a URL.
 *
 * Same contract as the event catalogue's `event-filters.ts`: the page is a
 * server component that reads `searchParams`, so a filtered or sorted directory
 * is a shareable link and stays server-rendered. Parsing is the boundary —
 * it validates and DROPS anything malformed, so a hand-edited or link-rotted URL
 * can never forward junk to the API and 400 the whole page.
 *
 * Dependency-free (no React, no imports) and unit-testable in isolation.
 */

export type DirectorySort = 'name' | 'club' | 'country';
export type DirectoryDir = 'asc' | 'desc';

export interface DirectoryFilters {
  q: string | null;
  /** Free text over the club name, separate from the combined `q` box. */
  club: string | null;
  country: string | null;
  weapon: string | null;
  sort: DirectorySort;
  dir: DirectoryDir;
  offset: number;
}

export const PAGE_SIZE = 24;

export const DEFAULT_DIRECTORY_FILTERS: DirectoryFilters = {
  q: null,
  club: null,
  country: null,
  weapon: null,
  sort: 'name',
  dir: 'asc',
  offset: 0,
};

type RawSearchParams = Record<string, string | string[] | undefined>;

const COUNTRY_CODE = /^[A-Za-z]{2}$/;
/** Matches the API's weapon slug shape; anything else is link rot. */
const WEAPON_SLUG = /^[a-z0-9-]{1,100}$/;

const SORTS: readonly DirectorySort[] = ['name', 'club', 'country'];

function first(value: string | string[] | undefined): string | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  return trimmed === '' ? null : trimmed;
}

export function parseDirectoryFilters(params: RawSearchParams): DirectoryFilters {
  const q = first(params['q']);
  const club = first(params['club']);
  const country = first(params['country']);
  const weapon = first(params['weapon']);
  const sort = first(params['sort']);
  const dir = first(params['dir']);

  // A negative or non-numeric offset would 400 the API and blank the page, so
  // it collapses to the first page rather than being forwarded.
  const parsedOffset = Number.parseInt(first(params['offset']) ?? '', 10);
  const offset = Number.isFinite(parsedOffset) && parsedOffset > 0 ? parsedOffset : 0;

  return {
    // Cap matches the API's own z.string().max(100).
    q: q ? q.slice(0, 100) : null,
    club: club ? club.slice(0, 100) : null,
    country: country && COUNTRY_CODE.test(country) ? country.toUpperCase() : null,
    weapon: weapon && WEAPON_SLUG.test(weapon) ? weapon : null,
    sort: SORTS.includes(sort as DirectorySort) ? (sort as DirectorySort) : 'name',
    dir: dir === 'desc' ? 'desc' : 'asc',
    offset,
  };
}

/**
 * Serialize to a query string (no leading `?`); empty at the defaults.
 *
 * Defaults are omitted so `/fighters` stays the canonical, linkable address for
 * the unfiltered directory rather than one of several spellings of it.
 */
export function toDirectoryQueryString(filters: DirectoryFilters): string {
  const params = new URLSearchParams();
  if (filters.q) params.set('q', filters.q);
  if (filters.club) params.set('club', filters.club);
  if (filters.country) params.set('country', filters.country);
  if (filters.weapon) params.set('weapon', filters.weapon);
  if (filters.sort !== 'name') params.set('sort', filters.sort);
  if (filters.dir !== 'asc') params.set('dir', filters.dir);
  if (filters.offset > 0) params.set('offset', String(filters.offset));
  return params.toString();
}

/** `/fighters`, with these filters. */
export function directoryHref(filters: DirectoryFilters): string {
  const qs = toDirectoryQueryString(filters);
  return qs ? `/fighters?${qs}` : '/fighters';
}

/**
 * The filters after clicking a column header.
 *
 * Clicking the ACTIVE column flips direction; clicking a new one starts
 * ascending. Either way the offset resets: page 3 of the old ordering is
 * meaningless against the new one, and keeping it strands the reader on a page
 * that may not exist.
 */
export function toggleSort(filters: DirectoryFilters, column: DirectorySort): DirectoryFilters {
  const isActive = filters.sort === column;
  return {
    ...filters,
    sort: column,
    dir: isActive && filters.dir === 'asc' ? 'desc' : 'asc',
    offset: 0,
  };
}

/**
 * Change one filter. Always resets the offset, for the same reason as above.
 */
export function withFilter<K extends keyof DirectoryFilters>(
  filters: DirectoryFilters,
  key: K,
  value: DirectoryFilters[K],
): DirectoryFilters {
  return { ...filters, [key]: value, offset: 0 };
}

export function hasAnyDirectoryFilter(filters: DirectoryFilters): boolean {
  return Boolean(filters.q || filters.club || filters.country || filters.weapon);
}
