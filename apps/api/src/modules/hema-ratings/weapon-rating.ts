/**
 * Pure HEMA-rating selection helpers, extracted so they can be unit-tested
 * without the snapshot/DB. Used by HemaRatingsService to resolve a fighter's
 * rating for a specific weapon — by linked id, or by name when no id is linked.
 */

export interface WeaponRating {
  weightedRating: number;
  rank: number | null;
}

export interface RatingRow {
  weapon: string;
  category?: string;
  rank: number | null;
  weightedRating: number;
  lastCompeted: string | null;
}

export interface SnapshotFighter {
  id: string | number | null;
  name: string;
  club?: string | null;
  ratings?: RatingRow[] | null;
}

function normalizeToken(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '');
}

/**
 * Best rating for `weapon` from a fighter's rows: weapon-token match, must have
 * competed within the last 2 years, newest `lastCompeted` wins. Mirrors the
 * recency rule HemaRatingsService.resolveWeightedRatings already applies for
 * pool seeding. Returns null when nothing qualifies.
 */
export function pickWeaponRating(
  rows: RatingRow[],
  weapon: string | null | undefined,
  now: Date,
): WeaponRating | null {
  if (!weapon || rows.length === 0) return null;
  const target = normalizeToken(weapon);
  const staleBefore = new Date(now);
  staleBefore.setFullYear(staleBefore.getFullYear() - 2);

  const candidates = rows
    .filter((r) => normalizeToken(r.weapon) === target)
    .filter((r) => {
      if (!r.lastCompeted) return false;
      const at = new Date(r.lastCompeted);
      return !Number.isNaN(at.getTime()) && at >= staleBefore;
    })
    .sort(
      (a, b) =>
        (b.lastCompeted ? Date.parse(b.lastCompeted) : 0) -
        (a.lastCompeted ? Date.parse(a.lastCompeted) : 0),
    );

  const best = candidates[0];
  return best ? { weightedRating: best.weightedRating, rank: best.rank ?? null } : null;
}

/**
 * Accent-fold + lowercase + punctuation-to-space, then sort the name tokens so
 * "Given Family" and "Family Given" normalize identically. Used to match a
 * participant's display name to a HEMA Ratings fighter when no id is linked.
 */
export function normalizePersonName(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .sort()
    .join(' ');
}

/**
 * Normalized-name → WeaponRating index for one weapon. A normalized name shared
 * by 2+ fighters is excluded (ambiguous → no rating rather than a wrong one),
 * as are fighters with no qualifying rating for the weapon.
 */
export function buildNameRatingIndex(
  fighters: SnapshotFighter[],
  weapon: string | null | undefined,
  now: Date,
): Map<string, WeaponRating> {
  const index = new Map<string, WeaponRating>();
  const ambiguous = new Set<string>();

  for (const fighter of fighters) {
    if (!fighter.name) continue;
    const rating = pickWeaponRating(fighter.ratings ?? [], weapon, now);
    if (!rating) continue;
    const key = normalizePersonName(fighter.name);
    if (!key || ambiguous.has(key)) continue;
    if (index.has(key)) {
      index.delete(key);
      ambiguous.add(key);
      continue;
    }
    index.set(key, rating);
  }

  return index;
}
