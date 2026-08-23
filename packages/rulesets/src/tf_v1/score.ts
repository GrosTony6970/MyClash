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
import {
  doublePenalty,
  evaluateDoublePenaltyAst,
  isDoublePenaltyAst,
  DOUBLE_PENALTY_FORMULAS,
  DOUBLE_PENALTY_FORMULA_KEYS,
  DOUBLE_PENALTY_VARIABLE,
  DEFAULT_DOUBLE_PENALTY_FORMULA,
  FEDERAL_DOUBLE_PENALTY_AST,
  DoublePenaltySpecSchema,
  type DoublePenaltyFormula,
  type DoublePenaltySpec,
} from './double-penalty';
import type { TFv1Config } from './config';

// ── Constants ─────────────────────────────────────────────────────────────────

/** Default win bonus. Overridable per ruleset via TFv1Config.winBonus. */
// Imported (computeMatchScore below calls doublePenalty through computeScore)
// AND re-exported, so this module's long-standing double-penalty entry points
// are unchanged. `tf_v1.fal2026.test.ts` — the immovable golden — imports
// `doublePenalty` from here, so this barrel is load-bearing, not convenience.
export {
  doublePenalty,
  evaluateDoublePenaltyAst,
  isDoublePenaltyAst,
  DOUBLE_PENALTY_FORMULAS,
  DOUBLE_PENALTY_FORMULA_KEYS,
  DOUBLE_PENALTY_VARIABLE,
  DEFAULT_DOUBLE_PENALTY_FORMULA,
  FEDERAL_DOUBLE_PENALTY_AST,
  DoublePenaltySpecSchema,
  type DoublePenaltyFormula,
  type DoublePenaltySpec,
};

// The ranking maths moved to @myclash/rules: aggregates in, a number out, no
// schema anywhere. Re-exported so nothing importing from this module changed.
export { WIN_BONUS, computeAggregates, computeScore } from '@myclash/rules';
export type { FighterAggregates, ScoreOptions } from '@myclash/rules';

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
