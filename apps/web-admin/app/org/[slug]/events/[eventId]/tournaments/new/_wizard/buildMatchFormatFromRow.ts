/**
 * Hydrate Step 2 (Match Format) from the persisted tournament row.
 *
 * Same pluck-not-spread discipline as `buildTfFromRow` — the row's
 * `ruleset_config.matchFormat` and `scoring_config_json` can each
 * carry legacy / engine-only fields that the strict API DTO will 400
 * on if they get PATCHed back. We never round-trip anything we don't
 * recognise.
 */

export interface WizardMatchFormat {
  pointCap: number;
  timerMode: 'countdown' | 'countup';
  timeLimitsSeconds: { pool: number | null; bracket: number | null; finals: number | null };
  softClockLimitSeconds: number;
  maxDoubleHits: number | null;
  afterblowMode: 'full' | 'deductive';
  scoringDirection: 'normal' | 'reverse_zero_loses';
}

export const MATCH_FORMAT_DEFAULTS: WizardMatchFormat = {
  pointCap: 5,
  timerMode: 'countdown',
  timeLimitsSeconds: { pool: 180, bracket: 240, finals: 300 },
  softClockLimitSeconds: 60,
  maxDoubleHits: 3,
  afterblowMode: 'full',
  scoringDirection: 'normal',
};

interface MatchFormatLike {
  pointCap?: unknown;
  timerMode?: unknown;
  timeLimitsSeconds?: { pool?: unknown; bracket?: unknown; finals?: unknown } | null;
  softClockLimitSeconds?: unknown;
  maxDoubleHits?: unknown;
  scoringDirection?: unknown;
}

function numberOrNull(value: unknown, fallback: number | null): number | null {
  if (value === null) return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  return fallback;
}

function num(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function buildMatchFormatFromRow(
  rulesetConfig: { matchFormat?: MatchFormatLike } & Record<string, unknown>,
  scoringConfig: Record<string, unknown>,
  defaults: WizardMatchFormat,
): WizardMatchFormat {
  const mf = (rulesetConfig.matchFormat ?? {}) as MatchFormatLike;
  const tls = (mf.timeLimitsSeconds ?? {}) as {
    pool?: unknown;
    bracket?: unknown;
    finals?: unknown;
  };
  return {
    pointCap: num(mf.pointCap, defaults.pointCap),
    timerMode: mf.timerMode === 'countup' ? 'countup' : defaults.timerMode,
    timeLimitsSeconds: {
      pool: numberOrNull(tls.pool, defaults.timeLimitsSeconds.pool),
      bracket: numberOrNull(tls.bracket, defaults.timeLimitsSeconds.bracket),
      finals: numberOrNull(tls.finals, defaults.timeLimitsSeconds.finals),
    },
    softClockLimitSeconds: num(mf.softClockLimitSeconds, defaults.softClockLimitSeconds),
    maxDoubleHits: numberOrNull(mf.maxDoubleHits, defaults.maxDoubleHits),
    scoringDirection:
      mf.scoringDirection === 'reverse_zero_loses'
        ? 'reverse_zero_loses'
        : defaults.scoringDirection,
    afterblowMode:
      scoringConfig['afterblowMode'] === 'deductive' ? 'deductive' : defaults.afterblowMode,
  };
}
