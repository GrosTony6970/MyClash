/**
 * @myclash/rules — the deterministic competition core.
 *
 * ZERO runtime dependencies, not even zod. That is the whole contract, and
 * `scripts/check-package-purity.mjs` enforces it: everything in here must be
 * reachable from apps/web-staff on a tablet with no network, which is what
 * ARCHITECTURE.md 7.3 ("Seed, don't resolve") requires of the scoring pad.
 *
 * The seam: `@myclash/rulesets` RESOLVES a ruleset -- turning a code, a version,
 * a stored AST or a config blob into plain data, and it may need zod and a
 * database to do it. `@myclash/rules` APPLIES a resolved ruleset to match data,
 * and needs nothing.
 */
export { computeAfterblowDeltas } from './afterblow';
export type { AfterblowMode } from './afterblow';

export type { Exchange, ExchangeType, Match, MatchScore, PhaseType, StrikerColor } from './domain';

export {
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
  isSoftClockLocked,
  pointCapWinnerColor,
  roundWinTarget,
} from './match-format';
export type {
  MatchFormatConfig,
  RoundEvaluation,
  RoundScorer,
  ScoringDirection,
  TimerMode,
} from './match-format';

// The formula AST, its evaluator and the stats it reads. The zod schemas that
// validate an AUTHORED tree stay in @myclash/rulesets: authoring is resolution,
// evaluating is application.
export * from './formula';

// The double-penalty term of a ranking score: a whitelisted key, or an authored
// AST run by our own interpreter. The zod schema that validates a stored spec
// stays in @myclash/rulesets.
export {
  DEFAULT_DOUBLE_PENALTY_FORMULA,
  DOUBLE_PENALTY_FORMULAS,
  DOUBLE_PENALTY_FORMULA_KEYS,
  DOUBLE_PENALTY_VARIABLE,
  FEDERAL_DOUBLE_PENALTY_AST,
  doublePenalty,
  evaluateDoublePenaltyAst,
  formatDoublePenalty,
  isDoublePenaltyAst,
} from './tf_v1/double-penalty';
export type { DoublePenaltyFormula, DoublePenaltySpec } from './tf_v1/double-penalty';

// The TF_v1 ranking score. Its two Ruleset contract methods stay in
// @myclash/rulesets: they normalise an unvalidated config first, and that is
// resolution.
export { WIN_BONUS, computeAggregates, computeScore } from './tf_v1/score';
export type { FighterAggregates, ScoreOptions } from './tf_v1/score';

// How a competition's Matches are laid out: pools, seeding, brackets, Swiss.
// The referee assigner and the fighter/referee conflict check stay in
// @myclash/rulesets — they read staff and identities, which is resolution.
export * from './scheduling';
