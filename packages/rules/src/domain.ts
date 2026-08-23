/**
 * The bout shapes the competition core reasons about.
 *
 * These are the MINIMAL forms — enough to derive a result, and no more. The full
 * row shapes, with their database columns and their optional display fields,
 * stay in `@myclash/types`. Keeping the minimal ones here is what lets a test
 * call any rule with a plain object literal instead of a fixture.
 *
 * They lived in `@myclash/rulesets/src/types.ts`, which meant the arithmetic
 * that reads them had to live beside zod. It does not need zod.
 */

export type ExchangeType = 'clean' | 'afterblow' | 'double' | 'no_exchange';
export type StrikerColor = 'red' | 'blue' | null;

/** `phases.type` — the four values the DB CHECK constraint allows. */
export type PhaseType = 'pool' | 'single_elim' | 'double_elim' | 'swiss';

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
  phaseType?: PhaseType;
  matchNumberLabel?: string | null;
}

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
