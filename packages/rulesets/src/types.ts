/**
 * packages/rulesets/src/types.ts
 *
 * Ruleset plugin contract — matches ARCHITECTURE.md §7.1 exactly.
 *
 * All rulesets must implement this interface. The engine is pure:
 * no DB access, no I/O, no side effects. Inputs are plain data objects.
 */

// ── Domain types (minimal — full types live in @myclash/types) ────────────────

// The bout shapes moved to @myclash/rules, which has no dependencies, so the
// arithmetic that reads them is reachable from the scoring pad. Re-exported so
// nothing importing from this module changed.
import type {
  AfterblowMode,
  Exchange,
  ExchangeType,
  Match,
  MatchScore,
  ScoredMatch,
  StrikerColor,
} from '@myclash/rules';

export type { AfterblowMode, Exchange, ExchangeType, Match, MatchScore, ScoredMatch, StrikerColor };

// `afterblowValuation` below was a second hand-written copy of this union. The
// scoring buttons are DERIVED from it in @myclash/types, which this package
// already depends on, so one import replaces the copy and the API drift guard
// that watched them.
import type { AfterblowValuation } from '@myclash/types';

/** What a ruleset needs to score a set of fighters over a set of finished bouts. */
export interface ScorePoolFightersInput {
  /** Every fighter to return a score for, including those who fought nothing. */
  registrationIds: string[];
  /** Finished bouts only. Each carries its own exchanges. */
  completedMatches: ScoredMatch[];
  /** The TOURNAMENT's afterblow mode. See `computeMatchScore`. */
  afterblowMode: AfterblowMode;
  /** The ruleset's own config blob, unvalidated. */
  config: unknown;
}

// ── Output types ──────────────────────────────────────────────────────────────

export interface MatchEndDecision {
  isOver: boolean;
  reason: 'time_limit' | 'first_to_points' | 'max_doubles' | 'manual' | null;
}

export interface FighterAggregates {
  wins: number;
  targetPoints: number;
  timesHit: number;
  doubles: number;
}

// ── Standings / ranking metadata ─────────────────────────────────────────────

export interface StandingsColumn {
  /** Stable key used in row.stats[key] and in the rankingChain. */
  key: string;
  /** Header label, e.g. 'Wins'. Plain string; consumer applies i18n on top if needed. */
  label: string;
  /** Render hint. */
  type: 'number' | 'string';
  /** True when higher = better (e.g. wins, points). False/undefined for fields where lower is better (doubles, hits received). */
  sortDesc?: boolean;
  /**
   * Fixed number of decimal places for display (e.g. 2 for a ratio score so it
   * always renders "4.00" / "2.18"). Omitted for integer columns (wins, points)
   * which render as-is. Consumers apply `value.toFixed(decimals)`.
   */
  decimals?: number;
}

/**
 * One step of a ranking chain. Implemented in `@myclash/rules`, because
 * `applyRanking` -- the sorter that executes a chain -- lives beside the rest
 * of the deterministic core and cannot import this package.
 */
export type { RankingRule } from '@myclash/rules';
import type { RankingRule } from '@myclash/rules';

/**
 * Audit-friendly summary of a ruleset's defaults. Surfaced through
 * `GET /api/v1/rulesets` so the admin UI can render a read-only
 * "ruleset details" panel without re-implementing config parsing.
 *
 * All fields are optional — rulesets only populate what's relevant.
 */
export interface RulesetMetadata {
  /**
   * Whether this ruleset uses the afterblow concept at all. Drives whether
   * afterblow controls are offered when configuring a tournament — replacing
   * the `rulesetCode === 'TF_v1'` checks that hardcoded one federation's
   * grammar into the UI.
   */
  hasAfterblow?: boolean;
  /**
   * Whether this ruleset has a doubles CEILING — the pool-only rule that ends a
   * bout as a 0-0 double loss once both fighters have traded a set number of
   * simultaneous hits.
   *
   * Declared for the same reason `hasAfterblow` is: the ceiling lives on the
   * SHARED match format, so every ruleset embedding `MatchFormatConfigSchema`
   * inherited it whether or not it had a rule for one. `Generic_PointsCap` did
   * not, and the mismatch was a bout that could not be finished — the score
   * collapsed to 0-0 at the cap while its `isMatchOver` had no branch to end on.
   *
   * Distinct from `doublePenaltyFormula`, which is TF_v1's per-double SCORE
   * penalty. A ruleset can have one, both or neither.
   */
  hasMaxDoubles?: boolean;
  /**
   * How an afterblow is WORTH points, when the ruleset has them at all.
   *
   *  - `fixed`    — the retaliation is always worth `afterblowFixedValue`,
   *                 whatever it landed on. This is FFAMHE's convention: its
   *                 published results have `1-1` and `2-1` columns and no
   *                 `2-2`, and every afterblow stat bucket in the database
   *                 keys on `first_strike_value`, never on `afterblow_value`.
   *  - `weighted` — the retaliation is worth the target it hit, so the button
   *                 grid is the full attacker x defender product.
   *
   * Declaring the rule is what lets the scoring buttons be DERIVED rather than
   * guessed by a seeding heuristic.
   */
  afterblowValuation?: AfterblowValuation | null;
  /** The retaliation's worth under `fixed` valuation. Meaningless otherwise. */
  afterblowFixedValue?: number | null;
  /**
   * The afterblow mode a new tournament is SEEDED with. Never authoritative
   * at scoring time.
   *
   * The live mode is `tournaments.scoring_config_json.afterblowMode`, read by
   * every derivation path. Exchanges store RAW button values and are netted at
   * read, so if the engine ever preferred this field over the tournament's,
   * changing a ruleset would retroactively rewrite every score ever derived
   * under it. Seeds the tournament; the tournament stays the source of truth.
   */
  defaultAfterblowMode?: 'full' | 'deductive' | null;
  /** Win bonus (points awarded for a pool win), or null if not used. */
  winBonus?: number | null;
  /** Human-readable double-hit penalty formula, or null if no doubles concept. */
  doublePenaltyFormula?: string | null;
  /**
   * Named targets this ruleset scores, in the order they should be offered.
   * Supersedes the deepTarget/shallowTarget pair below; a ruleset with any
   * count other than two can only be described here.
   */
  targets?: ReadonlyArray<{ name: string; value: number }> | null;
  /**
   * @deprecated Use `targets`. Kept so admin surfaces that still render the
   * pair keep working during the migration.
   */
  deepTargetDefault?: number | null;
  /** @deprecated Use `targets`. */
  shallowTargetDefault?: number | null;
  /**
   * Human-readable score formula for display, or null if the ruleset has no
   * single closed-form score (e.g. simple points rulesets). The accompanying
   * numeric fields (winBonus, doublePenaltyFormula, target defaults) give the
   * live constants that parameterize it.
   */
  scoreFormula?: string | null;
}

// ── Plugin contract ───────────────────────────────────────────────────────────

export interface Ruleset {
  /** Stable identifier, e.g. "TF_v1" */
  code: string;

  /** Semantic version, e.g. "1.0.0" */
  version: string;

  /** Human-readable name for display */
  displayName: string;

  /**
   * Compute one match's score from its exchanges.
   *
   * `afterblowMode` is REQUIRED and is the TOURNAMENT's, never the ruleset's.
   * Exchanges store raw button values and are netted at read, so a caller that
   * forgot to thread it used to get 'full' by default while the product default
   * is 'deductive' — scoring the bout the wrong way, in silence. It used to be
   * smuggled onto the config object; a parameter cannot be forgotten.
   *
   * Must be a pure function — no DB, no I/O.
   */
  computeMatchScore(
    match: Match,
    exchanges: Exchange[],
    afterblowMode: AfterblowMode,
    config: unknown,
  ): MatchScore;

  /**
   * Decide if a match has ended, from the score the caller is about to persist.
   *
   * Takes the SCORE rather than the exchanges, for two reasons. It used to
   * re-derive the score itself, so every call scored the same bout twice. And
   * the caller adds penalties to the score after `computeMatchScore` returns
   * (`ScoringService.recomputeMatchScore`), so a decision made from exchanges was
   * made from a number nobody would ever see — a penalty could drop the
   * cap-reacher back below the cap and leave a bout completed with no winner.
   *
   * There is no `clockMs` parameter. Nothing that calls this has a clock: the
   * only production call passed a literal 0, so the `time_limit` branch could
   * never fire. A single fight that runs out of time is completed by
   * `ClockService`, not here.
   *
   * Must be a pure function — no DB, no I/O.
   */
  isMatchOver(match: Match, score: MatchScore, config: unknown): MatchEndDecision;

  /**
   * This ruleset's `score` for each fighter over a set of finished bouts.
   *
   * ── Why this is not `computePoolStandings` any more ────────────────────────
   * That method took a Pool, took Registrations, and returned rank, wins,
   * targetPoints, timesHit, doubles and score for each of them. Its only caller
   * read `score` and discarded the other five, invented the Pool as
   * `{ id: '', name: '' }`, invented Registrations with null seed and bib, and
   * reached all of it through three `as unknown as` casts because it holds
   * PostgREST rows and not domain objects.
   *
   * Ranking never lived here either. Each ruleset sorted its own rows and the
   * API threw that ordering away, because `applyRanking(rows, rankingChain)` has
   * to rank the flattened cross-pool "overall" view as well, where a per-pool
   * sort is meaningless. So TF_v1 sorted on its own hardcoded five keys while
   * its DECLARED `rankingChain` had four — two sorters, and the one that ran was
   * not the one the ruleset published. Asking only for the score leaves one
   * sorter and makes that divergence unrepresentable.
   *
   * Must be a pure function — no DB, no I/O.
   */
  scorePoolFighters(input: ScorePoolFightersInput): Map<string, number>;

  /** Declarative column schema for the pool-standings table. Dynamic columns shown
   *  alongside fixed Rank/Fighter/Status chrome columns. */
  standingsColumns: StandingsColumn[];

  /** Tiebreaker chain applied to standings. Order matters — first rule is primary,
   *  later rules break ties. */
  rankingChain: RankingRule[];

  /** Optional ruleset-specific defaults surfaced to admin audit UIs. */
  metadata?: RulesetMetadata;
}
