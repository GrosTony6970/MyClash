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
  ScoredMatch,
  ScorePoolFightersInput,
  AfterblowMode,
  MatchScore,
  MatchEndDecision,
  FighterAggregates,
  StandingsColumn,
  RankingRule,
  RulesetMetadata,
} from './types';

// Registry
export { RulesetRegistry } from './registry';
export {
  BestOfConfigSchema,
  DEFAULT_MATCH_FORMAT_CONFIG,
  LevelAtTimeConfigSchema,
  LevelChainSchema,
  LevelStepSchema,
  MatchFormatConfigSchema,
  ScoringDirectionSchema,
  TimerModeSchema,
  applyScoringDirection,
  computeMatchFormatScore,
  displayClockMs,
  effectiveTimeLimitSeconds,
  evaluateRound,
  getEffectiveBestOf,
  getEffectiveMatchTimeLimitSeconds,
  getEffectiveMaxDoubles,
  getPointCapWinnerRegistrationId,
  isMedalMatchLabel,
  isPointCapReached,
  pointCapEndsBout,
  boutOutcomes,
  chainAllowsLevelEnd,
  isDoubleLossBout,
  isSoftClockLocked,
  leadingColor,
  maxDoubleHitEndReason,
  maxDoubleHitZeroesScores,
  normalizeMatchFormatConfig,
  pendingLevelStep,
  pointCapWinnerColor,
  roundWinTarget,
  timeIsFinished,
  winnerColorFrom,
} from './match-format';
export type {
  BoutOutcome,
  LevelStep,
  MatchFormatConfig,
  MaxDoubleHitEndReason,
  MaxDoubleHitOutcome,
  RoundEvaluation,
  RoundScorer,
  ScoringDirection,
  TimerMode,
} from './match-format';

// Forfeit policies
export {
  DEFAULT_FORFEIT_POLICY,
  FORFEIT_REASONS,
  ForfeitPolicySchema,
  ForfeitReasonPolicySchema,
  ForfeitReasonSchema,
  isOverrideReason,
  normalizeForfeitPolicy,
  OVERRIDE_REASONS,
  resolveForfeitPolicy,
} from './forfeits';
export type { ForfeitPolicy, ForfeitReason, ForfeitReasonPolicy } from './forfeits';

// TF_v1 ruleset
export { TF_v1 } from './tf_v1';
export { TFv1ConfigSchema, TFv1DefaultConfig } from './tf_v1/config';
export type { TFv1Config } from './tf_v1/config';
// Named targets — the grammar half of a ruleset. Exported so the API validates
// authored targets against the same schema the engine parses.
export {
  TargetSchema,
  TargetsSchema,
  AuthoredTargetsSchema,
  DEFAULT_TARGETS,
  MAX_TARGETS,
  MAX_STORED_TARGET_VALUE,
  MAX_AUTHORED_TARGET_VALUE,
  withDerivedTargets,
  type Target,
} from './tf_v1/targets';
export { computeMatchScore, isMatchOver } from './tf_v1';
export { doublePenalty, computeScore, computeAggregates } from './tf_v1/score';
// The double-penalty whitelist. Exported so the API validates authored formulas
// against the same keys the engine dispatches on, instead of eval'ing a string.
export {
  DOUBLE_PENALTY_FORMULAS,
  DOUBLE_PENALTY_FORMULA_KEYS,
  DOUBLE_PENALTY_VARIABLE,
  DEFAULT_DOUBLE_PENALTY_FORMULA,
  FEDERAL_DOUBLE_PENALTY_AST,
  DoublePenaltySpecSchema,
  evaluateDoublePenaltyAst,
  isDoublePenaltyAst,
  formatDoublePenalty,
  type DoublePenaltyFormula,
  type DoublePenaltySpec,
} from './tf_v1/double-penalty';

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
  buildFormulaScope,
  type RulesetGrammar,
  deriveFighterStats,
  evaluateFormula,
  renderFormula,
  isVariableKey,
  previewFormulaScoring,
  DEFAULT_PREVIEW_SAMPLES,
} from './formula';
export type {
  BinaryOperator,
  DerivedFighterStats,
  FormulaConfig,
  FormulaConstants,
  FormulaNode,
  FormulaScope,
  FormulaScoringPreview,
  FormulaScoringSampleRow,
  RenderFormulaOptions,
  Tiebreaker,
  VariableKey,
} from './formula';

// Ruleset lineage (fork-vs-parent bucket diff)
export { diffRulesetBuckets, projectRulesetBuckets } from './lineage';
export type { BucketStatus, BucketDiff, RulesetBucketInputs, RulesetBucketRow } from './lineage';
export {
  diffPenaltyBucket,
  projectPenaltyBucketFromLive,
  projectPenaltyBucketFromSnapshot,
} from './penalty-lineage';

// Content-hash identity (canonical serialization; sha256 lives in the API)
export {
  canonicalizeScoringBehaviour,
  canonicalizePenaltyDefinition,
  stableStringify,
} from './content-hash';
export type {
  ScoringBehaviourInput,
  CodedScoringBehaviour,
  FormulaScoringBehaviour,
  ScoringGrammarInput,
  PenaltyBehaviourInput,
} from './content-hash';

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
