/**
 * @myclash/rulesets — public API
 */

// Types
export type {
  Ruleset,
  Exchange,
  ExchangeType,
  StrikerColor,
  Match,
  Registration,
  Pool,
  Phase,
  Event,
  MatchScore,
  MatchEndDecision,
  PoolStandingRow,
  FinalRankingRow,
  FighterAggregates,
  StandingsColumn,
  RankingRule,
  RulesetMetadata,
} from './types';

// Registry
export { registry } from './registry';
export {
  DEFAULT_MATCH_FORMAT_CONFIG,
  MatchFormatConfigSchema,
  ScoringDirectionSchema,
  TimerModeSchema,
  computeMatchClockMs,
  computeMatchFormatScore,
  getEffectiveMatchTimeLimitSeconds,
  getPointCapWinnerRegistrationId,
  isMedalMatch,
  isPointCapReached,
  isSoftClockLocked,
  normalizeMatchFormatConfig,
} from './match-format';
export type { MatchFormatConfig, ScoringDirection, TimerMode } from './match-format';

// Forfeit policies
export {
  DEFAULT_FORFEIT_POLICY,
  ForfeitPolicySchema,
  ForfeitReasonPolicySchema,
  ForfeitReasonSchema,
  normalizeForfeitPolicy,
  resolveForfeitPolicy,
} from './forfeits';
export type { ForfeitPolicy, ForfeitReason, ForfeitReasonPolicy } from './forfeits';

// TF_v1 ruleset
export { TF_v1 } from './tf_v1';
export { TFv1ConfigSchema, TFv1DefaultConfig } from './tf_v1/config';
export type { TFv1Config } from './tf_v1/config';
export { computeMatchScore, isMatchOver, computePoolStandings } from './tf_v1';
export { doublePenalty, computeScore, computeAggregates } from './tf_v1/score';

// Generic_PointsCap ruleset
export {
  Generic_PointsCap,
  GenericPointsCapConfigSchema,
  GenericPointsCapDefaultConfig,
} from './generic_points_cap';
export type { GenericPointsCapConfig } from './generic_points_cap';

// FormulaRuleset (data-driven, DB-authored)
export {
  DEFAULT_FORMULA_CONSTANTS,
  FORMULA_VARIABLE_KEYS,
  FormulaConfigSchema,
  FormulaConstantsSchema,
  FormulaNodeSchema,
  TiebreakerSchema,
  createFormulaRuleset,
  deriveFighterStats,
  evaluateFormula,
  isVariableKey,
} from './formula';
export type {
  BinaryOperator,
  DerivedFighterStats,
  FormulaConfig,
  FormulaConstants,
  FormulaNode,
  FormulaScope,
  Tiebreaker,
  VariableKey,
} from './formula';

// Penalty rulesets
export {
  computeDirectPenaltySanction,
  computePenaltySanction,
  normalizePenaltyCard,
  parsePenaltyRulesetCsv,
  penaltyCausesMatchForfeit,
  penaltyScoreDelta,
} from './penalties';
export type {
  ExistingPenaltyForSanction,
  PenaltyAccumulationScope,
  PenaltyCard,
  PenaltyRulesetDefinition,
  PenaltyRulesetEntry,
  PenaltyRulesetMetadata,
  PenaltySanctionResult,
  PenaltySource,
} from './penalties';
