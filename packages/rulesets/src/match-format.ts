import { z } from 'zod';
import type { Exchange, Match, MatchScore } from './types';

/**
 * How afterblow points are applied. Mirrors `AfterblowMode` in `@myclash/types`
 * (and `computeAfterblowDeltas` below mirrors that package's function) — kept
 * local so the ruleset engine stays dependency-free (zod only) and isn't pulled
 * into every app Dockerfile's workspace build graph.
 *
 * - `full`: both fighters score their button points (attacker, defender).
 * - `deductive`: the afterblow is subtracted from the attacker
 *   (`max(0, attacker − defender)`, never negative) and the defender scores 0 —
 *   getting hit back costs the attacker points.
 */
export type AfterblowMode = 'full' | 'deductive';

export function computeAfterblowDeltas(
  mode: AfterblowMode,
  attackerPts: number,
  defenderPts: number,
): { attackerDelta: number; defenderDelta: number } {
  if (mode === 'deductive') {
    return { attackerDelta: Math.max(0, attackerPts - defenderPts), defenderDelta: 0 };
  }
  return { attackerDelta: attackerPts, defenderDelta: defenderPts };
}

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

export type MatchFormatConfig = z.infer<typeof MatchFormatConfigSchema>;
export type ScoringDirection = z.infer<typeof ScoringDirectionSchema>;
export type TimerMode = z.infer<typeof TimerModeSchema>;

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

export function isMedalMatch(match: Match): boolean {
  const label = (match.matchNumberLabel ?? '').trim().toUpperCase();
  return (
    label === 'F' ||
    label === 'FINAL' ||
    label === 'GOLD' ||
    label === 'GOLD MEDAL MATCH' ||
    label === '3RD' ||
    label === 'BRONZE' ||
    label === 'BRONZE MEDAL MATCH'
  );
}

export function getEffectiveMatchTimeLimitSeconds(
  match: Match,
  config: MatchFormatConfig,
): number | null {
  if (match.phaseType === 'pool') return config.timeLimitsSeconds.pool;
  if (isMedalMatch(match)) return config.timeLimitsSeconds.finals;
  return config.timeLimitsSeconds.bracket;
}

/**
 * Effective best-of for this match by phase, mirroring the time-limit dispatch:
 * pool → bestOf.pool, medal match → bestOf.finals, else (bracket) → bestOf.bracket.
 * Returns 1 (single round) when bestOf is absent (legacy configs).
 */
export function getEffectiveBestOf(match: Match, config: MatchFormatConfig): number {
  const bestOf = config.bestOf ?? { pool: 1, bracket: 1, finals: 1 };
  if (match.phaseType === 'pool') return bestOf.pool;
  if (isMedalMatch(match)) return bestOf.finals;
  return bestOf.bracket;
}

/** Round wins needed to take a best-of-N match: ⌈N/2⌉ (1 for a single round). */
export function roundWinTarget(bestOf: number): number {
  return Math.ceil(Math.max(1, bestOf) / 2);
}

/**
 * Effective max-doubles end condition by phase. The max-doubles "double loss"
 * rule applies ONLY in pools — bracket & finals must always produce a winner, so
 * they never end on max-doubles (single-round or best-of). A match without a
 * known phase is treated as non-pool (no max-doubles), matching the time-limit
 * dispatch's default.
 */
export function getEffectiveMaxDoubles(match: Match, config: MatchFormatConfig): number | null {
  return match.phaseType === 'pool' ? config.maxDoubleHits : null;
}

/**
 * Which side reached the point cap, as a colour (mirrors
 * {@link getPointCapWinnerRegistrationId} without needing the registration ids).
 */
export function pointCapWinnerColor(
  score: Pick<MatchScore, 'redScore' | 'blueScore'>,
  config: MatchFormatConfig,
): 'red' | 'blue' | null {
  if (config.scoringDirection === 'reverse_zero_loses') {
    if (score.redScore <= 0 && score.blueScore <= 0) return null;
    if (score.redScore <= 0) return 'blue';
    if (score.blueScore <= 0) return 'red';
    return null;
  }
  if (score.redScore >= config.pointCap && score.blueScore >= config.pointCap) return null;
  if (score.redScore >= config.pointCap) return 'red';
  if (score.blueScore >= config.pointCap) return 'blue';
  return null;
}

export function computeMatchClockMs(
  match: Match,
  elapsedMs: number,
  config: MatchFormatConfig,
): number {
  if (config.timerMode === 'countup') return Math.max(0, elapsedMs);

  const limitSeconds = getEffectiveMatchTimeLimitSeconds(match, config);
  if (limitSeconds === null) return Math.max(0, elapsedMs);
  return Math.max(0, limitSeconds * 1000 - elapsedMs);
}

export function isSoftClockLocked(
  match: Match,
  elapsedMs: number,
  clockRunning: boolean,
  config: MatchFormatConfig,
): boolean {
  if (clockRunning || config.timerMode !== 'countdown' || config.softClockLimitSeconds <= 0) {
    return false;
  }

  const limitSeconds = getEffectiveMatchTimeLimitSeconds(match, config);
  if (limitSeconds === null) return false;
  const remainingMs = Math.max(0, limitSeconds * 1000 - elapsedMs);
  return remainingMs < config.softClockLimitSeconds * 1000;
}

export function computeMatchFormatScore(
  match: Match,
  exchanges: Exchange[],
  config: MatchFormatConfig,
  afterblowMode: AfterblowMode = 'full',
): MatchScore {
  const active = exchanges.filter((e) => !e.voided);

  let redEarned = 0;
  let blueEarned = 0;
  let redTargetPoints = 0;
  let blueTargetPoints = 0;
  let redTimesHit = 0;
  let blueTimesHit = 0;
  let doubles = 0;

  for (const ex of active) {
    switch (ex.type) {
      case 'clean':
        if (ex.firstStrikerColor === 'red') {
          redEarned += ex.firstStrikeValue ?? 0;
          redTargetPoints += ex.firstStrikeValue ?? 0;
          blueTimesHit += 1;
        } else if (ex.firstStrikerColor === 'blue') {
          blueEarned += ex.firstStrikeValue ?? 0;
          blueTargetPoints += ex.firstStrikeValue ?? 0;
          redTimesHit += 1;
        }
        break;

      case 'afterblow': {
        // Raw button values are stored on the exchange; the mode decides how
        // they net. In 'deductive' the defender's afterblow is subtracted from
        // the attacker (defender scores 0); in 'full' both keep their points.
        const { attackerDelta, defenderDelta } = computeAfterblowDeltas(
          afterblowMode,
          ex.firstStrikeValue ?? 0,
          ex.afterblowValue ?? 0,
        );
        if (ex.firstStrikerColor === 'red') {
          redEarned += attackerDelta;
          redTargetPoints += attackerDelta;
          blueEarned += defenderDelta;
          blueTargetPoints += defenderDelta;
          redTimesHit += 1;
        } else if (ex.firstStrikerColor === 'blue') {
          blueEarned += attackerDelta;
          blueTargetPoints += attackerDelta;
          redEarned += defenderDelta;
          redTargetPoints += defenderDelta;
          blueTimesHit += 1;
        }
        break;
      }

      case 'double':
        doubles += 1;
        break;

      case 'no_exchange':
        break;
    }
  }

  // Max-doubles "double loss" is a pool-only rule (bracket/finals must always
  // resolve to a winner). getEffectiveMaxDoubles returns null off the pool phase.
  const effectiveMaxDoubles = getEffectiveMaxDoubles(match, config);
  if (effectiveMaxDoubles !== null && doubles >= effectiveMaxDoubles) {
    return {
      redScore: 0,
      blueScore: 0,
      redWins: 0,
      blueWins: 0,
      redTargetPoints,
      blueTargetPoints,
      redTimesHit,
      blueTimesHit,
      doubles,
    };
  }

  const redScore =
    config.scoringDirection === 'reverse_zero_loses'
      ? Math.max(0, config.pointCap - blueEarned)
      : redEarned;
  const blueScore =
    config.scoringDirection === 'reverse_zero_loses'
      ? Math.max(0, config.pointCap - redEarned)
      : blueEarned;

  return {
    redScore,
    blueScore,
    redWins: 0,
    blueWins: 0,
    redTargetPoints,
    blueTargetPoints,
    redTimesHit,
    blueTimesHit,
    doubles,
  };
}

export function isPointCapReached(score: MatchScore, config: MatchFormatConfig): boolean {
  if (config.scoringDirection === 'reverse_zero_loses') {
    return score.redScore <= 0 || score.blueScore <= 0;
  }
  return score.redScore >= config.pointCap || score.blueScore >= config.pointCap;
}

export function getPointCapWinnerRegistrationId(
  match: Match,
  score: Pick<MatchScore, 'redScore' | 'blueScore'>,
  config: MatchFormatConfig,
): string | null {
  if (config.scoringDirection === 'reverse_zero_loses') {
    if (score.redScore <= 0 && score.blueScore <= 0) return null;
    if (score.redScore <= 0) return match.blueRegistrationId;
    if (score.blueScore <= 0) return match.redRegistrationId;
    return null;
  }

  if (score.redScore >= config.pointCap && score.blueScore >= config.pointCap) return null;
  if (score.redScore >= config.pointCap) return match.redRegistrationId;
  if (score.blueScore >= config.pointCap) return match.blueRegistrationId;
  return null;
}

/** A round's automatic end condition, evaluated from that round's exchanges. */
export interface RoundEvaluation {
  /** Live score of this round (current open round, or the round being closed). */
  score: MatchScore;
  /**
   * True when the round ended on an AUTOMATIC condition (point cap, or pool
   * max-doubles). Time-expiry is NOT automatic — it's operator-driven (the
   * engine never sees the clock here), so `autoOver` is false when only time
   * would end the round; the operator closes it via the End-round action.
   */
  autoOver: boolean;
  /** Round winner when `autoOver`; null for a drawn round (pool max-doubles). */
  winnerColor: 'red' | 'blue' | null;
  endReason: 'first_to_points' | 'max_doubles' | null;
}

/**
 * Evaluate a single round from its (round-scoped) exchanges. Used by the
 * best-of round lifecycle: the open round is scored live and auto-closes on
 * point cap or pool max-doubles. Reuses the per-fight scoring + cap rules.
 */
export function evaluateRound(
  match: Match,
  roundExchanges: Exchange[],
  config: MatchFormatConfig,
  afterblowMode: AfterblowMode = 'full',
): RoundEvaluation {
  const score = computeMatchFormatScore(match, roundExchanges, config, afterblowMode);

  if (isPointCapReached(score, config)) {
    return {
      score,
      autoOver: true,
      winnerColor: pointCapWinnerColor(score, config),
      endReason: 'first_to_points',
    };
  }

  const effectiveMaxDoubles = getEffectiveMaxDoubles(match, config);
  if (effectiveMaxDoubles !== null && score.doubles >= effectiveMaxDoubles) {
    // Pool only: a max-doubles double-loss is a drawn round (no round win).
    return { score, autoOver: true, winnerColor: null, endReason: 'max_doubles' };
  }

  return { score, autoOver: false, winnerColor: null, endReason: null };
}
