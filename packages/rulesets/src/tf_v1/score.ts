/**
 * packages/rulesets/src/tf_v1/score.ts
 *
 * TF_v1 score computation — pure functions, no I/O.
 * Implements ARCHITECTURE.md §6.1 and §6.2 exactly.
 *
 * AGENTS.md hard rule #1: scores are ALWAYS derived from exchanges.
 * Never store computed scores as the source of truth.
 */
import type { Exchange, Match, MatchEndDecision, MatchScore } from '../types';
import type { TFv1Config } from './config';

// ── Constants ─────────────────────────────────────────────────────────────────

export const WIN_BONUS = 3;

/**
 * Double penalty formula: n*(n-1)/3
 * Where n = total doubles in the match for this fighter.
 * ARCHITECTURE.md §6.2: DOUBLE_PENALTY(n) = n * (n - 1) / 3
 */
export function doublePenalty(n: number): number {
  if (n <= 1) return 0;
  return (n * (n - 1)) / 3;
}

// ── Per-fighter aggregates ────────────────────────────────────────────────────

export interface FighterAggregates {
  wins: number;
  targetPoints: number;
  timesHit: number;
  doubles: number;
}

/**
 * Compute per-fighter aggregates from non-voided exchanges.
 * ARCHITECTURE.md §6.1.
 */
export function computeAggregates(
  registrationId: string,
  match: Match,
  exchanges: Exchange[],
  isWinner: boolean,
): FighterAggregates {
  const isRed = match.redRegistrationId === registrationId;
  const myColor = isRed ? 'red' : 'blue';
  const opponentColor = isRed ? 'blue' : 'red';

  const active = exchanges.filter((e) => !e.voided);

  let targetPoints = 0;
  let timesHit = 0;
  let doubles = 0;

  for (const ex of active) {
    switch (ex.type) {
      case 'clean':
        if (ex.firstStrikerColor === myColor) {
          // I struck first (clean hit) → I gain first_strike_value
          targetPoints += ex.firstStrikeValue ?? 0;
        } else if (ex.firstStrikerColor === opponentColor) {
          // Opponent struck me → I was hit
          timesHit += 1;
        }
        break;

      case 'afterblow':
        if (ex.firstStrikerColor === myColor) {
          // I struck first → I gain first_strike_value
          targetPoints += ex.firstStrikeValue ?? 0;
          // NOTE: in afterblow, the FIRST striker receives the afterblow
          // (opponent landed afterblow on me) → I was hit
          timesHit += 1;
        } else if (ex.firstStrikerColor === opponentColor) {
          // Opponent struck first → opponent gains first_strike_value
          // I landed the afterblow → I gain afterblow_value
          targetPoints += ex.afterblowValue ?? 0;
        }
        break;

      case 'double':
        // Both struck simultaneously — no points, counts toward penalty
        doubles += 1;
        break;

      case 'no_exchange':
        // No score effect
        break;
    }
  }

  return {
    wins: isWinner ? 1 : 0,
    targetPoints,
    timesHit,
    doubles,
  };
}

/**
 * Compute TF_v1 score for a fighter.
 * ARCHITECTURE.md §6.2:
 *   SCORE = (wins * WIN_BONUS + targetPoints) / (timesHit + doublePenalty(doubles))
 *
 * Edge case: if denominator = 0, treat as denominator = 1.
 */
export function computeScore(agg: FighterAggregates): number {
  const numerator = agg.wins * WIN_BONUS + agg.targetPoints;
  const denominator = agg.timesHit + doublePenalty(agg.doubles);

  // Edge case: denominator = 0 → treat as 1 (ARCHITECTURE.md §6.2)
  if (denominator === 0) {
    return numerator;
  }

  return numerator / denominator;
}

// ── Match score ───────────────────────────────────────────────────────────────

/**
 * Compute the full match score from exchanges.
 * Returns scores for both red and blue.
 */
export function computeMatchScore(
  match: Match,
  exchanges: Exchange[],
  _config: TFv1Config,
): MatchScore {
  const active = exchanges.filter((e) => !e.voided);

  // Determine winner from current exchange state
  // (In TF_v1, the match winner is determined by the organizer/referee
  // at match end — we compute running scores here)
  let redScore = 0;
  let blueScore = 0;
  let redTargetPoints = 0;
  let blueTargetPoints = 0;
  let redTimesHit = 0;
  let blueTimesHit = 0;
  let doubles = 0;

  for (const ex of active) {
    switch (ex.type) {
      case 'clean':
        if (ex.firstStrikerColor === 'red') {
          redScore += ex.firstStrikeValue ?? 0;
          redTargetPoints += ex.firstStrikeValue ?? 0;
          blueTimesHit += 1;
        } else if (ex.firstStrikerColor === 'blue') {
          blueScore += ex.firstStrikeValue ?? 0;
          blueTargetPoints += ex.firstStrikeValue ?? 0;
          redTimesHit += 1;
        }
        break;

      case 'afterblow':
        if (ex.firstStrikerColor === 'red') {
          redScore += ex.firstStrikeValue ?? 0;
          redTargetPoints += ex.firstStrikeValue ?? 0;
          // Red struck first → red receives afterblow
          blueScore += ex.afterblowValue ?? 0;
          blueTargetPoints += ex.afterblowValue ?? 0;
          redTimesHit += 1;
        } else if (ex.firstStrikerColor === 'blue') {
          blueScore += ex.firstStrikeValue ?? 0;
          blueTargetPoints += ex.firstStrikeValue ?? 0;
          // Blue struck first → blue receives afterblow
          redScore += ex.afterblowValue ?? 0;
          redTargetPoints += ex.afterblowValue ?? 0;
          blueTimesHit += 1;
        }
        break;

      case 'double':
        doubles += 1;
        break;

      case 'no_exchange':
        break;
    }
  }

  return {
    redScore,
    blueScore,
    redWins: 0, // wins determined at match end, not from exchanges
    blueWins: 0,
    redTargetPoints,
    blueTargetPoints,
    redTimesHit,
    blueTimesHit,
    doubles,
  };
}

// ── Match end decision ────────────────────────────────────────────────────────

/**
 * Decide if a TF_v1 match has ended.
 * Checks: time limit, first-to-points, max-doubles.
 */
export function isMatchOver(
  _match: Match,
  exchanges: Exchange[],
  clockMs: number,
  config: TFv1Config,
): MatchEndDecision {
  const active = exchanges.filter((e) => !e.voided);

  // Time limit
  if (config.matchFormat.timeLimitSeconds !== null) {
    if (clockMs >= config.matchFormat.timeLimitSeconds * 1000) {
      return { isOver: true, reason: 'time_limit' };
    }
  }

  // First-to-points
  if (config.matchFormat.firstToPoints !== null) {
    const score = computeMatchScore(_match, active, config);
    if (
      score.redScore >= config.matchFormat.firstToPoints ||
      score.blueScore >= config.matchFormat.firstToPoints
    ) {
      return { isOver: true, reason: 'first_to_points' };
    }
  }

  // Max doubles
  if (config.matchFormat.maxDoubles !== null) {
    const doubleCount = active.filter((e) => e.type === 'double').length;
    if (doubleCount >= config.matchFormat.maxDoubles) {
      return { isOver: true, reason: 'max_doubles' };
    }
  }

  return { isOver: false, reason: null };
}
