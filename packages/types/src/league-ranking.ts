/**
 * What separates one league ranking table from another.
 *
 * Shared because the API and every admin screen have to agree on it, and did
 * not: the union was written out as a literal in five places, so adding a value
 * updated the type in one of them and left `as 'weapon' | 'weapon_category'`
 * casts silently accepting the new value everywhere else.
 *
 *   'weapon'          → one table per weapon; every group merged into it
 *   'weapon_category' → one per weapon per league GROUP
 *   'group'           → one table per group, weapon ignored
 *
 * `weapon_category` is a historical name, not a description: it meant
 * `tournaments.category` until migration 0049 dropped that column, and has
 * meant the league group ever since. The stored value is deliberately left
 * alone — renaming it would need a migration over every league's
 * `scoring_config` for a string only developers read.
 *
 * A tournament linked with no group normalises to `unknown`, so ungrouped
 * tournaments share a table rather than falling out of the rankings.
 */
export type LeagueRankingDimensions = 'weapon' | 'weapon_category' | 'group';

export const LEAGUE_RANKING_DIMENSIONS: readonly LeagueRankingDimensions[] = [
  'weapon',
  'weapon_category',
  'group',
] as const;

/** Narrows an unknown string from a `<select>` or an API payload. */
export function isLeagueRankingDimensions(value: unknown): value is LeagueRankingDimensions {
  return (
    typeof value === 'string' && (LEAGUE_RANKING_DIMENSIONS as readonly string[]).includes(value)
  );
}
