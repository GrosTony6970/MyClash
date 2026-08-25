import { z } from 'zod';
import {
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
  leadingColor,
  maxDoubleHitEndReason,
  maxDoubleHitZeroesScores,
  pointCapWinnerColor,
  roundWinTarget,
  type Match,
  type MatchFormatConfig,
  type MatchScore,
  type MaxDoubleHitEndReason,
  type MaxDoubleHitOutcome,
  type RoundEvaluation,
  type RoundScorer,
  type ScoringDirection,
  type TimerMode,
} from '@myclash/rules';
import type { MatchEndDecision } from './types';
// The default match format is a plain literal in @myclash/types — see its
// docblock for why that side owns it. The schema below must still PRODUCE it,
// which match-format.test.ts asserts by parsing an empty config.
import { DEFAULT_MATCH_FORMAT_CONFIG } from '@myclash/types';

// The arithmetic moved to @myclash/rules, which has no dependencies and is
// therefore reachable from the scoring pad. Re-exported so nothing importing
// from this module changed.
export {
  DEFAULT_MATCH_FORMAT_CONFIG,
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
  leadingColor,
  maxDoubleHitEndReason,
  maxDoubleHitZeroesScores,
  pointCapWinnerColor,
  roundWinTarget,
};
export type { MaxDoubleHitEndReason, MaxDoubleHitOutcome, RoundEvaluation, RoundScorer };

// Afterblow netting lives in @myclash/rules -- the zero-dependency core. This
// file used to carry its own copy, and said why in a comment: kept local "so
// the ruleset engine stays dependency-free (zod only) and isn't pulled into
// every app Dockerfile's workspace build graph". That was a PACKAGE constraint,
// not a capability one. @myclash/rules has no dependencies at all, so the
// reason is gone and the two copies are one. Re-exported so nothing importing
// from this module changed.
import { computeAfterblowDeltas, type AfterblowMode } from '@myclash/rules';

export { computeAfterblowDeltas };
export type { AfterblowMode };

export const ScoringDirectionSchema = z.enum(['normal', 'reverse_zero_loses']);
export const TimerModeSchema = z.enum(['countdown', 'countup']);
export const MaxDoubleHitOutcomeSchema = z.enum([
  'double_loss_zero_scores',
  'draw_zero_scores',
  'result_stands',
]);

/** Best-of value: an odd integer ≥ 1 (1 = single round). */
const BestOfValueSchema = z
  .number()
  .int()
  .refine((n) => n >= 1 && n % 2 === 1, { message: 'bestOf must be an odd number ≥ 1' });

export const BestOfConfigSchema = z
  .object({
    pool: BestOfValueSchema.default(1),
    /** Optional, falling back to `pool` — see `timeLimitsSeconds.swiss`. */
    swiss: BestOfValueSchema.optional(),
    bracket: BestOfValueSchema.default(1),
    finals: BestOfValueSchema.default(1),
  })
  .default({ pool: 1, bracket: 1, finals: 1 });

export const MatchFormatConfigSchema = z.object({
  // Federal-rulebook (FFAMHE) baseline. Any ruleset that wants different
  // values must persist its own override into tf_config.matchFormat (TF v1)
  // or match_format_defaults (custom rulesets); both are merged over this
  // schema's defaults at form-hydration time, so stored overrides survive.
  pointCap: z.number().int().positive().default(10),
  scoringDirection: ScoringDirectionSchema.default('normal'),
  timerMode: TimerModeSchema.default('countdown'),
  timeLimitsSeconds: z
    .object({
      pool: z.number().int().positive().nullable().default(90),
      /**
       * Deliberately `.optional()` and NOT `.default()`. Every ruleset config
       * persisted before the Swiss format lacks this key; a default would
       * materialise 90s into all of them on the next round-trip and make the
       * "Swiss inherits the pool clock" fallback unreachable.
       */
      swiss: z.number().int().positive().nullable().optional(),
      bracket: z.number().int().positive().nullable().default(90),
      finals: z.number().int().positive().nullable().default(90),
    })
    .default({ pool: 90, bracket: 90, finals: 90 }),
  softClockLimitSeconds: z.number().int().min(0).default(5),
  maxDoubleHits: z.number().int().positive().nullable().default(4),
  maxDoubleHitOutcome: MaxDoubleHitOutcomeSchema.default('double_loss_zero_scores'),
  // Best-of-N rounds per phase; ⌈N/2⌉ round wins decides the match. 1 = single
  // round (default everywhere — unchanged behaviour). See getEffectiveBestOf.
  bestOf: BestOfConfigSchema,
});

/**
 * The shape is declared in `@myclash/rules`; this schema VALIDATES INTO it.
 *
 * That is the inversion the extraction is for. `MatchFormatConfig` used to be
 * `z.infer<typeof MatchFormatConfigSchema>`, so every consumer of the type
 * needed zod on its import path, and `@myclash/types` answered that by
 * hand-writing a second structurally identical interface that nothing checked
 * against this one.
 *
 * The assertion below is that check, and it is a compile error rather than a
 * test: add a field to the schema without adding it to the interface, or change
 * a type on either side, and this file stops compiling.
 */
type SchemaOutput = z.infer<typeof MatchFormatConfigSchema>;
type Exact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const _schemaMatchesTheContract: Exact<SchemaOutput, MatchFormatConfig> = true;
void _schemaMatchesTheContract;

export type { MatchFormatConfig, ScoringDirection, TimerMode };

type LegacyMatchFormatConfig = {
  firstToPoints?: number | null;
  timeLimitSeconds?: number | null;
  maxDoubles?: number | null;
};

export function normalizeMatchFormatConfig(input: unknown): MatchFormatConfig {
  if (!input || typeof input !== 'object') return DEFAULT_MATCH_FORMAT_CONFIG;

  const raw = input as Record<string, unknown> & LegacyMatchFormatConfig;
  const hasSharedShape =
    'pointCap' in raw ||
    'scoringDirection' in raw ||
    'timerMode' in raw ||
    'timeLimitsSeconds' in raw ||
    'softClockLimitSeconds' in raw ||
    'maxDoubleHits' in raw ||
    // Route a config that carries ONLY bestOf through the strict-parse branch
    // below (which preserves it); the legacy branch would silently drop it.
    'bestOf' in raw;

  if (hasSharedShape) {
    const parsed = MatchFormatConfigSchema.parse(raw);
    const legacyTimeLimit =
      typeof raw.timeLimitSeconds === 'number' || raw.timeLimitSeconds === null
        ? raw.timeLimitSeconds
        : undefined;
    return MatchFormatConfigSchema.parse({
      ...parsed,
      pointCap: typeof raw.firstToPoints === 'number' ? raw.firstToPoints : parsed.pointCap,
      timeLimitsSeconds:
        legacyTimeLimit === undefined
          ? parsed.timeLimitsSeconds
          : {
              pool: legacyTimeLimit,
              bracket: legacyTimeLimit,
              finals: legacyTimeLimit,
            },
      maxDoubleHits:
        typeof raw.maxDoubles === 'number' || raw.maxDoubles === null
          ? raw.maxDoubles
          : parsed.maxDoubleHits,
    });
  }

  const timeLimitSeconds =
    typeof raw.timeLimitSeconds === 'number' || raw.timeLimitSeconds === null
      ? raw.timeLimitSeconds
      : DEFAULT_MATCH_FORMAT_CONFIG.timeLimitsSeconds.pool;

  return MatchFormatConfigSchema.parse({
    pointCap:
      typeof raw.firstToPoints === 'number'
        ? raw.firstToPoints
        : DEFAULT_MATCH_FORMAT_CONFIG.pointCap,
    timeLimitsSeconds: {
      pool: timeLimitSeconds,
      bracket: timeLimitSeconds,
      finals: timeLimitSeconds,
    },
    maxDoubleHits:
      typeof raw.maxDoubles === 'number' || raw.maxDoubles === null
        ? raw.maxDoubles
        : DEFAULT_MATCH_FORMAT_CONFIG.maxDoubleHits,
  });
}

/**
 * The end decision for a ruleset that HAS a doubles ceiling: first to the point
 * cap, then max-doubles.
 *
 * One owner, because two rulesets need exactly this and they used not to agree.
 * TF_v1 implemented it; `createFormulaRuleset` delegated to `Generic_PointsCap`,
 * which has no ceiling and therefore no `max_doubles` branch — so an
 * org-authored ruleset zeroed its scores at the cap and then had nothing to end
 * on, leaving the bout stuck at 0-0 with every further hit discarded.
 *
 * Max-doubles ends a bout only in pools and Swiss rounds; bracket and finals
 * must resolve to a winner, and `getEffectiveMaxDoubles` returns null there.
 * `score.doubles` is the count of non-voided `double` exchanges.
 */
export function endOnPointCapOrMaxDoubles(
  match: Pick<Match, 'phaseType'>,
  score: MatchScore,
  matchFormat: MatchFormatConfig,
): MatchEndDecision {
  if (isPointCapReached(score, matchFormat)) {
    return { isOver: true, reason: 'first_to_points' };
  }
  const effectiveMaxDoubles = getEffectiveMaxDoubles(match, matchFormat);
  if (effectiveMaxDoubles !== null && score.doubles >= effectiveMaxDoubles) {
    // The organiser's chosen outcome is resolved into the REASON here, once.
    // Every later reader of the finished bout then has the answer on the row —
    // which the SQL stats function and the cross-event fighter stats need,
    // because neither can reach the tournament's match format.
    return { isOver: true, reason: maxDoubleHitEndReason(matchFormat) };
  }
  return { isOver: false, reason: null };
}
