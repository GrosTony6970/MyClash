/**
 * Normalized substring search for the public Pool Matches list. Matches
 * a query against the round code, both fighter names, both club labels,
 * status, and lice name. Trim + lowercase + accent-fold so "remi"
 * matches "Rémi". Empty queries keep every row. Dependency-free + pure
 * so it can be unit-tested; mirrors `filter-participants.ts`.
 */

export interface FilterableMatch {
  roundCode: string;
  redFighterName: string | null;
  blueFighterName: string | null;
  redClubAbbrev: string | null;
  blueClubAbbrev: string | null;
  status: string;
  liceName: string | null;
}

function normalize(value: string): string {
  return value.normalize('NFD').replace(/[̀-ͯ]/gu, '').toLowerCase();
}

export function matchesQuery(m: FilterableMatch, rawQuery: string): boolean {
  const needle = normalize(rawQuery.trim());
  if (needle === '') return true;
  const haystack = normalize(
    [
      m.roundCode,
      m.redFighterName,
      m.blueFighterName,
      m.redClubAbbrev,
      m.blueClubAbbrev,
      m.status,
      m.liceName,
    ]
      .filter((v): v is string => typeof v === 'string')
      .join(' '),
  );
  return haystack.includes(needle);
}
