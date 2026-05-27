import { z } from 'zod';
import type { Exchange, Match, MatchScore } from './types';

export const ScoringDirectionSchema = z.enum(['normal', 'reverse_zero_loses']);
export const TimerModeSchema = z.enum(['countdown', 'countup']);
export const MaxDoubleHitOutcomeSchema = z.literal('double_loss_zero_scores');

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
    'maxDoubleHits' in raw;

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

      case 'afterblow':
        if (ex.firstStrikerColor === 'red') {
          redEarned += ex.firstStrikeValue ?? 0;
          redTargetPoints += ex.firstStrikeValue ?? 0;
          blueEarned += ex.afterblowValue ?? 0;
          blueTargetPoints += ex.afterblowValue ?? 0;
          redTimesHit += 1;
        } else if (ex.firstStrikerColor === 'blue') {
          blueEarned += ex.firstStrikeValue ?? 0;
          blueTargetPoints += ex.firstStrikeValue ?? 0;
          redEarned += ex.afterblowValue ?? 0;
          redTargetPoints += ex.afterblowValue ?? 0;
          blueTimesHit += 1;
        }
        break;

      case 'double':
        doubles += 1;
        break;

      case 'no_exchange':
        break;
    }
  }

  if (config.maxDoubleHits !== null && doubles >= config.maxDoubleHits) {
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
