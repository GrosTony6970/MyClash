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

/**
 * A finished bout, as the standings maths reads it: who fought, who won, and
 * what happened in it.
 *
 * Every ruleset used to reach these two extra fields through a cast --
 * `(match as Match & { exchanges?: Exchange[]; winnerRegistrationId?: string })`
 * -- because `Match` carries neither, and the API then built a `Match` it did
 * not have by casting a PostgREST row through `as unknown as`. Naming the shape
 * that was actually being passed removes both.
 *
 * There is no `status`: a caller passes COMPLETED bouts. Every implementation
 * used to filter for that itself, and the API's only caller had already
 * filtered, so the field existed to be re-checked and never to be false.
 *
 * ── One disagreement this type does not settle ──────────────────────────────
 * TF_v1 and Generic_PointsCap read `winnerRegistrationId` to count a win. The
 * formula ruleset ignores it and calls the bout by raw score (`derive-stats.ts`,
 * `deriveFighterStats`). So the two can disagree about who won a bout that was
 * awarded against the points -- a forfeit, say. That is real, it predates this
 * type, and putting both fields in one shape must not be read as having fixed
 * it.
 */
export interface ScoredMatch {
  id: string;
  redRegistrationId: string;
  blueRegistrationId: string;
  winnerRegistrationId: string | null;
  exchanges: Exchange[];
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
