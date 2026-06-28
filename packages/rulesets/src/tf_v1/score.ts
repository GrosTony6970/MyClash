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
import {
  computeAfterblowDeltas,
  computeMatchFormatScore,
  getEffectiveMatchTimeLimitSeconds,
  getEffectiveMaxDoubles,
  isPointCapReached,
  normalizeMatchFormatConfig,
  type AfterblowMode,
} from '../match-format';
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
  afterblowMode: AfterblowMode = 'full',
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

      case 'afterblow': {
        // Raw button values are stored; the mode decides how they net. In
        // 'deductive' the afterblow is subtracted from the attacker and the
        // afterblow-lander gains 0.
        const { attackerDelta, defenderDelta } = computeAfterblowDeltas(
          afterblowMode,
          ex.firstStrikeValue ?? 0,
          ex.afterblowValue ?? 0,
        );
        if (ex.firstStrikerColor === myColor) {
          // I struck first → I gain the (possibly deducted) attacker points
          targetPoints += attackerDelta;
          // NOTE: in afterblow, the FIRST striker receives the afterblow
          // (opponent landed afterblow on me) → I was hit
          timesHit += 1;
        } else if (ex.firstStrikerColor === opponentColor) {
          // Opponent struck first → I landed the afterblow → I gain the
          // defender points (0 in deductive mode)
          targetPoints += defenderDelta;
        }
        break;
      }

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
  config: TFv1Config,
  afterblowMode: AfterblowMode = 'full',
): MatchScore {
  return computeMatchFormatScore(
    match,
    exchanges,
    normalizeMatchFormatConfig(config.matchFormat),
    afterblowMode,
  );
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
  afterblowMode: AfterblowMode = 'full',
): MatchEndDecision {
  const active = exchanges.filter((e) => !e.voided);
  const matchFormat = normalizeMatchFormatConfig(config.matchFormat);

  const timeLimitSeconds = getEffectiveMatchTimeLimitSeconds(_match, matchFormat);
  if (timeLimitSeconds !== null) {
    if (clockMs >= timeLimitSeconds * 1000) {
      return { isOver: true, reason: 'time_limit' };
    }
  }

  const score = computeMatchScore(_match, active, config, afterblowMode);
  if (isPointCapReached(score, matchFormat)) {
    return { isOver: true, reason: 'first_to_points' };
  }

  // Max-doubles ends a match only in pools (bracket/finals must resolve to a
  // winner); getEffectiveMaxDoubles returns null off the pool phase.
  const effectiveMaxDoubles = getEffectiveMaxDoubles(_match, matchFormat);
  if (effectiveMaxDoubles !== null) {
    const doubleCount = active.filter((e) => e.type === 'double').length;
    if (doubleCount >= effectiveMaxDoubles) {
      return { isOver: true, reason: 'max_doubles' };
    }
  }

  return { isOver: false, reason: null };
}
