/**
 * Hydrate Step 2 (Match Format) from the persisted tournament row.
 *
 * Same pluck-not-spread discipline as `buildTfFromRow` — the row's
 * `ruleset_config.matchFormat` and `scoring_config_json` can each
 * carry legacy / engine-only fields that the strict API DTO will 400
 * on if they get PATCHed back. We never round-trip anything we don't
 * recognise.
 */

import type { LevelStep } from '@myclash/types';
import type { LevelAtTimeChains } from './LevelAtTimeEditor';

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
  /** What the referee plays when the clock runs out and nobody leads. */
  levelAtTime: LevelAtTimeChains;
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
  // A drawn pool bout is a real result; a drawn elimination bout cannot
  // advance, so it is played out. Mirrors DEFAULT_MATCH_FORMAT_CONFIG.
  levelAtTime: {
    pool: [{ kind: 'draw' }],
    bracket: [{ kind: 'extra_time', seconds: 60 }, { kind: 'sudden_death' }],
    finals: [{ kind: 'extra_time', seconds: 60 }, { kind: 'sudden_death' }],
  },
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
  levelAtTime?: { pool?: unknown; bracket?: unknown; finals?: unknown } | null;
}

/**
 * One stored chain, or the default when the row holds anything else.
 *
 * Same pluck-not-spread discipline as the rest of this file, and it matters
 * more here: the API's match-format schema is `.strict()` and refines the last
 * step, so a shape this did not recognise would round-trip straight into a 400
 * on a save the organiser never asked for.
 */
function levelChain(value: unknown, fallback: LevelStep[]): LevelStep[] {
  if (!Array.isArray(value) || value.length === 0) return fallback;
  const steps: LevelStep[] = [];
  for (const raw of value) {
    const kind = (raw as { kind?: unknown } | null)?.kind;
    if (kind === 'draw' || kind === 'sudden_death') {
      steps.push({ kind });
    } else if (kind === 'extra_time') {
      const seconds = (raw as { seconds?: unknown }).seconds;
      if (typeof seconds !== 'number' || !Number.isFinite(seconds)) return fallback;
      steps.push({ kind: 'extra_time', seconds });
    } else {
      return fallback;
    }
  }
  // A chain ending in extra time is one the API refuses, so a stored row in
  // that shape is not something to hand back to the editor.
  return steps[steps.length - 1]?.kind === 'extra_time' ? fallback : steps;
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
    levelAtTime: levelChainsFrom(mf.levelAtTime, defaults.levelAtTime),
  };
}

/**
 * The three stored chains, each plucked or defaulted.
 *
 * Exported because the settings tab hydrates by hand rather than through
 * {@link buildMatchFormatFromRow}, and both surfaces must agree on what a
 * stored row means — otherwise one of them offers the organiser a chain the
 * other would silently replace.
 */
export function levelChainsFrom(value: unknown, defaults: LevelAtTimeChains): LevelAtTimeChains {
  const lat = (value ?? {}) as { pool?: unknown; bracket?: unknown; finals?: unknown };
  return {
    pool: levelChain(lat.pool, defaults.pool),
    bracket: levelChain(lat.bracket, defaults.bracket),
    finals: levelChain(lat.finals, defaults.finals),
  };
}
