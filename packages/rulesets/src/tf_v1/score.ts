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
  computeMatchFormatScore,
  getEffectiveMatchTimeLimitSeconds,
  isPointCapReached,
  normalizeMatchFormatConfig,
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
  config: TFv1Config,
): MatchScore {
  return computeMatchFormatScore(match, exchanges, normalizeMatchFormatConfig(config.matchFormat));
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
  const matchFormat = normalizeMatchFormatConfig(config.matchFormat);

  const timeLimitSeconds = getEffectiveMatchTimeLimitSeconds(_match, matchFormat);
  if (timeLimitSeconds !== null) {
    if (clockMs >= timeLimitSeconds * 1000) {
      return { isOver: true, reason: 'time_limit' };
    }
  }

  const score = computeMatchScore(_match, active, config);
  if (isPointCapReached(score, matchFormat)) {
    return { isOver: true, reason: 'first_to_points' };
  }

  if (matchFormat.maxDoubleHits !== null) {
    const doubleCount = active.filter((e) => e.type === 'double').length;
    if (doubleCount >= matchFormat.maxDoubleHits) {
      return { isOver: true, reason: 'max_doubles' };
    }
  }

  return { isOver: false, reason: null };
}
