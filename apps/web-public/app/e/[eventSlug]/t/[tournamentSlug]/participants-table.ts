/**
 * Pure sort + filter for the public Participants table. Dependency-free so it
 * unit-tests cleanly; mirrors the `filter-participants.ts` / natural-compare
 * patterns elsewhere in web-public.
 */

export type SortKey = 'name' | 'club' | 'rating';
export type SortDir = 'asc' | 'desc';

interface NameClub {
  displayName: string;
  clubName: string | null;
  clubAbbrev: string | null;
}

function normalize(value: string): string {
  return value.normalize('NFD').replace(/[̀-ͯ]/gu, '').toLowerCase();
}

/**
 * Stable-ish sort by name / club / rating. Rows with no club (club sort) or no
 * rating (rating sort) always sort LAST regardless of direction. Returns a new
 * array — the input is not mutated.
 */
export function sortParticipants<
  T extends {
    displayName: string;
    clubName: string | null;
    hemaRating: { weightedRating: number } | null;
  },
>(rows: T[], key: SortKey, dir: SortDir): T[] {
  const sign = dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    if (key === 'name') {
      return sign * a.displayName.localeCompare(b.displayName, undefined, { sensitivity: 'base' });
    }
    if (key === 'club') {
      // Null clubs last in both directions.
      if (!a.clubName && !b.clubName) return 0;
      if (!a.clubName) return 1;
      if (!b.clubName) return -1;
      return sign * a.clubName.localeCompare(b.clubName, undefined, { sensitivity: 'base' });
    }
    // rating — unrated last in both directions.
    const ra = a.hemaRating?.weightedRating ?? null;
    const rb = b.hemaRating?.weightedRating ?? null;
    if (ra === null && rb === null) return 0;
    if (ra === null) return 1;
    if (rb === null) return -1;
    return sign * (ra - rb);
  });
}

/** Accent/case-insensitive substring filter over name + club + abbreviation. */
export function filterParticipants<T extends NameClub>(rows: T[], query: string): T[] {
  const needle = normalize(query.trim());
  if (needle === '') return rows;
  return rows.filter((r) => {
    const haystack = normalize(
      [r.displayName, r.clubName, r.clubAbbrev]
        .filter((v): v is string => typeof v === 'string')
        .join(' '),
    );
    return haystack.includes(needle);
  });
}
