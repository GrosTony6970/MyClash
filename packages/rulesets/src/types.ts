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
}
