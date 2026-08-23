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

export type { Exchange, ExchangeType, Match, MatchScore, StrikerColor } from './domain';

export {
  computeMatchClockMs,
  computeMatchFormatScore,
  evaluateRound,
  getEffectiveBestOf,
  getEffectiveMatchTimeLimitSeconds,
  getEffectiveMaxDoubles,
  getPointCapWinnerRegistrationId,
  isMedalMatch,
  isPointCapReached,
  isSoftClockLocked,
  pointCapWinnerColor,
  roundWinTarget,
} from './match-format';
export type {
  MatchFormatConfig,
  RoundEvaluation,
  ScoringDirection,
  TimerMode,
} from './match-format';

// The formula AST, its evaluator and the stats it reads. The zod schemas that
// validate an AUTHORED tree stay in @myclash/rulesets: authoring is resolution,
// evaluating is application.
export * from './formula';
