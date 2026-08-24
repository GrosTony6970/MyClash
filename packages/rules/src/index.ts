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

export type {
  Exchange,
  ExchangeType,
  Match,
  MatchScore,
  PhaseType,
  ScoredMatch,
  StrikerColor,
} from './domain';

// The vocabulary of ORDER, shared by every ranked table in the product. Two of
// these unions had more than one owner before they landed here.
export { SWISS_TIEBREAK_KEYS } from './ranking';
export type {
  FinalRankingResultKind,
  LeagueRankingDimensions,
  RankingRule,
  SecondChanceTarget,
  SwissTiebreakKey,
} from './ranking';

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

// Competition scheduling — pools, seeding, brackets, Swiss — is reached through
// `@myclash/rules/scheduling`, NOT from this barrel. Nothing the scoring pad runs
// lays out a bracket, and this package is CJS with no tree-shaking, so
// re-exporting it here shipped it to all three apps: `@myclash/types` re-exports
// this barrel and every app imports `@myclash/types`. It cost ~5.3 KB gzip on
// EVERY page load of web-staff, web-public and web-admin alike.
//
// `perf:bundle` does print that number, so this was visible rather than hidden
// — it just never went red, because all three budgets had the headroom to
// absorb it. Adding a value to this barrel spends that headroom everywhere at
// once, which is why server-only maths gets a subpath instead.
