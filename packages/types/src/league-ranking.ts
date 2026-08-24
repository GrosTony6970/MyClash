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
export type { LeagueRankingDimensions } from '@myclash/rules/pad';
import type { LeagueRankingDimensions } from '@myclash/rules/pad';

export const LEAGUE_RANKING_DIMENSIONS = ['weapon', 'weapon_category', 'group'] as const;

/**
 * Pins the list above to the union, in BOTH directions, at compile time.
 *
 * `readonly LeagueRankingDimensions[]` only checks one: it rejects a list entry
 * the union lacks, and says nothing when the union gains a value the list never
 * offers -- which is the direction that actually bites, because the list is
 * what a `<select>` renders. Widening the union alone would silently produce a
 * dimension no screen can pick.
 *
 * `AssertNever` is the load-bearing part, and it is easy to get wrong. A
 * `const x: [Missing, Extra] = [null as never, null as never]` looks equivalent
 * and checks NOTHING, because `never` is assignable to every type -- so the
 * assignment succeeds however wide the leftover union is. Constraining a type
 * PARAMETER is what actually fails: `'club' extends never` is an error,
 * `never extends never` is not.
 */
type AssertNever<T extends never> = T;

export type LeagueRankingDimensionsAreExhaustive = [
  AssertNever<Exclude<LeagueRankingDimensions, (typeof LEAGUE_RANKING_DIMENSIONS)[number]>>,
  AssertNever<Exclude<(typeof LEAGUE_RANKING_DIMENSIONS)[number], LeagueRankingDimensions>>,
];

/** Narrows an unknown string from a `<select>` or an API payload. */
export function isLeagueRankingDimensions(value: unknown): value is LeagueRankingDimensions {
  return (
    typeof value === 'string' && (LEAGUE_RANKING_DIMENSIONS as readonly string[]).includes(value)
  );
}
