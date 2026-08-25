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
  /** What reaching the ceiling DOES. Only the first value is a loss for both. */
  maxDoubleHitOutcome: 'double_loss_zero_scores' | 'draw_zero_scores' | 'result_stands';
  afterblowMode: 'full' | 'deductive';
  scoringDirection: 'normal' | 'reverse_zero_loses';
  /** Best-of-N rounds per phase; 1 = single round. Odd values only (1/3/5/7). */
  bestOf: { pool: number; bracket: number; finals: number };
}

export const MATCH_FORMAT_DEFAULTS: WizardMatchFormat = {
  pointCap: 5,
  timerMode: 'countdown',
  timeLimitsSeconds: { pool: 180, bracket: 240, finals: 300 },
  softClockLimitSeconds: 60,
  maxDoubleHits: 3,
  maxDoubleHitOutcome: 'double_loss_zero_scores',
  afterblowMode: 'full',
  scoringDirection: 'normal',
  bestOf: { pool: 1, bracket: 1, finals: 1 },
};

/**
 * The doubles-ceiling outcomes, offered in both admin surfaces.
 *
 * KEYS, not strings, for the reason `BEST_OF_OPTIONS` spells out beside its own
 * list: resolved at module init they would bind to the EN-only module-level `t`
 * and the selector would read English whatever the organiser chose. The caller
 * maps them through its own hook-provided `t`.
 */
export const MAX_DOUBLE_HIT_OUTCOME_OPTIONS = [
  {
    value: 'double_loss_zero_scores',
    labelKey: 'organizer.tournaments.settings.maxDoubleHitDoubleLoss',
  },
  { value: 'draw_zero_scores', labelKey: 'organizer.tournaments.settings.maxDoubleHitDraw' },
  { value: 'result_stands', labelKey: 'organizer.tournaments.settings.maxDoubleHitResultStands' },
] as const;

interface MatchFormatLike {
  pointCap?: unknown;
  timerMode?: unknown;
  timeLimitsSeconds?: { pool?: unknown; bracket?: unknown; finals?: unknown } | null;
  softClockLimitSeconds?: unknown;
  maxDoubleHits?: unknown;
  maxDoubleHitOutcome?: unknown;
  scoringDirection?: unknown;
  bestOf?: { pool?: unknown; bracket?: unknown; finals?: unknown } | null;
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
  const bo = (mf.bestOf ?? {}) as { pool?: unknown; bracket?: unknown; finals?: unknown };
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
    maxDoubleHitOutcome:
      mf.maxDoubleHitOutcome === 'draw_zero_scores' || mf.maxDoubleHitOutcome === 'result_stands'
        ? mf.maxDoubleHitOutcome
        : defaults.maxDoubleHitOutcome,
    scoringDirection:
      mf.scoringDirection === 'reverse_zero_loses'
        ? 'reverse_zero_loses'
        : defaults.scoringDirection,
    afterblowMode:
      scoringConfig['afterblowMode'] === 'deductive' ? 'deductive' : defaults.afterblowMode,
    bestOf: {
      pool: num(bo.pool, defaults.bestOf.pool),
      bracket: num(bo.bracket, defaults.bestOf.bracket),
      finals: num(bo.finals, defaults.bestOf.finals),
    },
  };
}
