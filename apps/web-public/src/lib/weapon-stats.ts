/**
 * Shared weapon-name normalization + medal helpers used by every fighter-stats
 * surface: the /me/profile FighterStatsCard, the shared FighterStatsPanel (public
 * fighter page + group member cards). Framework-free so both server and client
 * modules can import it — the single source of truth for weapon keying.
 */

export type TFn = (key: string, values?: Record<string, string | number>) => string;

/** Per-scope combat stats (overall or one weapon), as returned by the API's
 *  buildFighterCareer().finalizeStats — see apps/api fighter-career.ts. */
export interface WeaponStat {
  weapon?: string;
  matches: number;
  wins: number;
  losses: number;
  winLossRatio: number | null;
  doubleHits: number;
  exchanges: number;
  doubleHitPercentage: number;
}

/** A manually imported podium from a tournament not run in the app. */
export interface FighterMedal {
  competition: string;
  year: number;
  rank: number;
  weapon: string;
}

/** A fighter's final placement in one completed in-app tournament (server-computed
 *  via the shared computeFinalRanking). Note the field is `place`, not `rank`. */
export interface FighterPlacement {
  tournamentId: string;
  tournamentName: string;
  tournamentSlug: string;
  eventName: string;
  eventSlug: string;
  weapon: string | null;
  date: string | null;
  place: number | null;
  resultKind: string | null;
  totalRanked: number | null;
}

/** Weapon-name tokens for fuzzy matching: accent-folded, lowercased, split on
 *  non-alphanumerics, with the connector word "and" dropped so "Rapier &
 *  Dagger" and "Rapier and Dagger" tokenize identically. */
export function weaponTokens(value: string): Set<string> {
  return new Set(
    value
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .split(/[^a-z0-9]+/)
      .filter((token) => token && token !== 'and'),
  );
}

/** A normalized dedup key for a weapon name (sorted tokens), so tournament
 *  free-text and controlled catalog names collapse: "Longsword" ≡ "longsword". */
export function weaponKey(value: string): string {
  return [...weaponTokens(value)].sort().join(' ');
}

/** The HEMA rating whose weapon best matches a tournament weapon string: a
 *  rating matches when all its weapon tokens appear in the tournament weapon's
 *  tokens (so "Longsword Open" matches "Longsword"); ties break to the most
 *  specific (most tokens). Returns null when nothing matches. */
export function matchHemaRating<T extends { weapon: string }>(
  tournamentWeapon: string,
  ratings: readonly T[],
): T | null {
  const target = weaponTokens(tournamentWeapon);
  if (target.size === 0) return null;
  let best: T | null = null;
  let bestSize = 0;
  for (const rating of ratings) {
    const tokens = weaponTokens(rating.weapon);
    if (tokens.size === 0 || tokens.size <= bestSize) continue;
    if ([...tokens].every((token) => target.has(token))) {
      best = rating;
      bestSize = tokens.size;
    }
  }
  return best;
}

/** Zeroed combat stats for a weapon with no in-app matches (e.g. one the fighter
 *  only has imported medals for, or only selected in their profile). */
export const ZERO_WEAPON_STAT: WeaponStat = {
  matches: 0,
  wins: 0,
  losses: 0,
  winLossRatio: null,
  doubleHits: 0,
  exchanges: 0,
  doubleHitPercentage: 0,
};

/** Medal glyph for a podium finish; empty for everyone else. */
export function medalGlyph(place: number | null): string {
  if (place === 1) return '🥇';
  if (place === 2) return '🥈';
  if (place === 3) return '🥉';
  return '';
}

/** Headline for a placement: a medal word for the podium, otherwise `#N`. */
export function placeHeadline(place: number | null, t: TFn): string {
  if (place === 1) return t('publicApp.fighterProfile.resultChampion');
  if (place === 2) return t('publicApp.fighterProfile.resultRunnerUp');
  if (place === 3) return t('publicApp.fighterProfile.resultThird');
  return place != null ? `#${place}` : '—';
}
