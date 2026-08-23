/**
 * packages/rulesets/src/types.ts
 *
 * Ruleset plugin contract — matches ARCHITECTURE.md §7.1 exactly.
 *
 * All rulesets must implement this interface. The engine is pure:
 * no DB access, no I/O, no side effects. Inputs are plain data objects.
 */
import type { ZodSchema } from 'zod';

// ── Domain types (minimal — full types live in @myclash/types) ────────────────

// The bout shapes moved to @myclash/rules, which has no dependencies, so the
// arithmetic that reads them is reachable from the scoring pad. Re-exported so
// nothing importing from this module changed.
import type { Exchange, ExchangeType, Match, MatchScore, StrikerColor } from '@myclash/rules';

export type { Exchange, ExchangeType, Match, MatchScore, StrikerColor };

export interface Registration {
  id: string;
  seed: number | null;
  bibNumber: number | null;
}

export interface Pool {
  id: string;
  name: string;
}

export interface Phase {
  id: string;
  type: 'pool' | 'single_elim' | 'double_elim' | 'swiss';
}

export interface Event {
  id: string;
  name: string;
}

// ── Output types ──────────────────────────────────────────────────────────────

export interface MatchEndDecision {
  isOver: boolean;
  reason: 'time_limit' | 'first_to_points' | 'max_doubles' | 'manual' | null;
}

export interface PoolStandingRow {
  registrationId: string;
  rank: number;
  wins: number;
  targetPoints: number;
  timesHit: number;
  doubles: number;
  score: number;
}

export interface FinalRankingRow {
  registrationId: string;
  rank: number;
  score: number;
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

export interface RankingRule {
  /** Matches a StandingsColumn.key. */
  key: string;
  /** 'desc' = higher is better. */
  direction: 'asc' | 'desc';
}

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
  afterblowValuation?: 'fixed' | 'weighted' | null;
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

  /** Zod schema for validating ruleset_config JSON */
  configSchema: ZodSchema;

  /**
   * Compute one match's score from its exchanges.
   * Must be a pure function — no DB, no I/O.
   */
  computeMatchScore(match: Match, exchanges: Exchange[], config: unknown): MatchScore;

  /**
   * Decide if a match has ended.
   * Must be a pure function — no DB, no I/O.
   */
  isMatchOver(
    match: Match,
    exchanges: Exchange[],
    clockMs: number,
    config: unknown,
  ): MatchEndDecision;

  /**
   * Compute pool standings from all matches in the pool.
   * Must be a pure function — no DB, no I/O.
   */
  computePoolStandings(
    pool: Pool,
    matches: Match[],
    registrations: Registration[],
    config: unknown,
  ): PoolStandingRow[];

  /**
   * Optional: compute event-level final ranking from pool + elim phases.
   * Must be a pure function — no DB, no I/O.
   */
  computeFinalRanking?(event: Event, phases: Phase[], config: unknown): FinalRankingRow[];

  /** Declarative column schema for the pool-standings table. Dynamic columns shown
   *  alongside fixed Rank/Fighter/Status chrome columns. */
  standingsColumns: StandingsColumn[];

  /** Tiebreaker chain applied to standings. Order matters — first rule is primary,
   *  later rules break ties. */
  rankingChain: RankingRule[];

  /** Optional ruleset-specific defaults surfaced to admin audit UIs. */
  metadata?: RulesetMetadata;
}
