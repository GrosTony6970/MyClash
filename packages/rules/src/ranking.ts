/**
 * The vocabulary of ORDER: what separates one ranked row from the next, and
 * what separates one ranked table from another.
 *
 * Everything here is a plain union or a frozen list — no arithmetic. It lives
 * in this package for one reason: the maths that reads these words is moving
 * here out of `apps/api`, and `scripts/check-package-purity.mjs` rule 2 refuses
 * ANY outward import from this package, a type-only one included. So a rule
 * cannot arrive before the words it is written in.
 *
 * Each entry below was previously owned somewhere else, and two of them were
 * owned in more than one place at once. A union spelled out twice is the defect
 * this repo keeps producing: widening one copy leaves the other silently
 * accepting a value it has no branch for.
 */

/**
 * One step of a ranking chain: which column to compare, and which way is better.
 * Was `packages/rulesets/src/types.ts`; `Ruleset.rankingChain` is an array of
 * these and `applyRanking` is the sorter that executes them.
 */
export interface RankingRule {
  /** Matches a StandingsColumn.key. */
  key: string;
  /** 'desc' = higher is better. */
  direction: 'asc' | 'desc';
}

/**
 * Which podium model a double-elimination bracket uses — whether the second
 * chance plays for gold or for bronze.
 *
 * Had THREE independent definitions: the generator's
 * (`scheduling/double-elim-shape.ts`), the final-ranking reader's
 * (`@myclash/types`' `final-ranking-core.ts`) and a third declared inline in
 * `apps/web-admin`'s DoubleElimPodiumOptions component. Nothing paired them, so
 * a third podium model would have been accepted by whichever copy was widened
 * and unhandled by the other two.
 */
export type SecondChanceTarget = 'gold' | 'bronze';

/**
 * How a fighter's final placing was arrived at. Drives the medal: champion /
 * runnerUp / third map to gold / silver / bronze, so a semi-final loser placed
 * third with no bronze match ('round') gets no phantom medal.
 *
 * Was `@myclash/types`' `final-ranking-core.ts`, which still owns the SHAPES
 * that carry it and re-exports this from here.
 */
export type FinalRankingResultKind =
  | 'champion'
  | 'runnerUp'
  | 'third'
  | 'fourth'
  | 'round'
  | 'pool'
  /**
   * Placed by the Swiss standings rather than by a bracket result. Distinct
   * from 'pool' because that kind means "never reached the bracket" and sorts
   * strictly below every bracket entrant — a Swiss fighter placed 5th was not
   * eliminated from anything.
   */
  | 'swiss';

/**
 * What separates one league ranking table from another.
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
 *
 * `@myclash/types` keeps the runtime list and the narrowing guard, and pins
 * them against this union so the two cannot drift apart.
 */
export type LeagueRankingDimensions = 'weapon' | 'weapon_category' | 'group';

/**
 * Every tiebreak an organiser may put in a Swiss chain, in the order the
 * picker offers them.
 *
 * Was written out TWICE — once in the API's `swiss-config.dto.ts`, once inline
 * in web-admin's TiebreakChainField under a comment reading "Mirrors
 * SWISS_TIEBREAK_KEYS on the API". The comment was the only thing holding them
 * together, and a comment does not fail a build.
 */
export const SWISS_TIEBREAK_KEYS = [
  'buchholz',
  'buchholzCut1',
  'sonnebornBerger',
  'opponentWinPct',
  'headToHead',
  /** The ruleset's own score. */
  'score',
  'wins',
  'diff',
  'ptsScored',
  'doubles',
  'hitsReceived',
  /**
   * Sentinel, not a stat: splices the ruleset's own `rankingChain` in at this
   * position. Lets an organiser say "Buchholz first, then whatever this ruleset
   * normally does" without restating the ruleset's rules.
   */
  'rulesetChain',
] as const;

export type SwissTiebreakKey = (typeof SWISS_TIEBREAK_KEYS)[number];
