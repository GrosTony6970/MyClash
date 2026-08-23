import { z } from 'zod';
import {
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
  type MatchFormatConfig,
  type RoundEvaluation,
  type ScoringDirection,
  type TimerMode,
} from '@myclash/rules';

// The arithmetic moved to @myclash/rules, which has no dependencies and is
// therefore reachable from the scoring pad. Re-exported so nothing importing
// from this module changed.
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
};
export type { RoundEvaluation };

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
export const MaxDoubleHitOutcomeSchema = z.literal('double_loss_zero_scores');

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

export const DEFAULT_MATCH_FORMAT_CONFIG: MatchFormatConfig = MatchFormatConfigSchema.parse({});

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
