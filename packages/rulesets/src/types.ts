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

export type ExchangeType = 'clean' | 'afterblow' | 'double' | 'no_exchange';
export type StrikerColor = 'red' | 'blue' | null;

export interface Exchange {
  id: string;
  clientUuid: string;
  matchId: string;
  sequence: number;
  type: ExchangeType;
  occurredAt: string;
  firstStrikerColor: StrikerColor;
  firstStrikeValue: 1 | 2 | null;
  afterblowValue: 1 | 2 | null;
  noExchangeReason: string | null;
  voided: boolean;
}

export interface Match {
  id: string;
  redRegistrationId: string;
  blueRegistrationId: string;
  rulesetCode: string;
  rulesetVersion: string;
  status: 'scheduled' | 'running' | 'paused' | 'completed' | 'voided';
  phaseType?: 'pool' | 'single_elim' | 'double_elim' | 'swiss';
  matchNumberLabel?: string | null;
}

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

export interface MatchScore {
  redScore: number;
  blueScore: number;
  /** Derived aggregates for display */
  redWins: number;
  blueWins: number;
  redTargetPoints: number;
  blueTargetPoints: number;
  redTimesHit: number;
  blueTimesHit: number;
  doubles: number;
}

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
  /** Whether this ruleset uses the afterblow concept. */
  hasAfterblow?: boolean;
  /** Win bonus (points awarded for a pool win), or null if not used. */
  winBonus?: number | null;
  /** Human-readable double-hit penalty formula, or null if no doubles concept. */
  doublePenaltyFormula?: string | null;
  /** Default deep-target points value (e.g. 2 in TF v1). */
  deepTargetDefault?: number | null;
  /** Default shallow-target points value (e.g. 1 in TF v1). */
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
