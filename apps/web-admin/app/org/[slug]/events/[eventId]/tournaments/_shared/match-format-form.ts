/**
 * The Match Format form (the settings tab and wizard Step 2): read from the rules in force the API
 * answers (`effectiveRules`), never from a default of its own (operator rulings 43, 46). It held
 * cap 5 / 180 s / soft clock 60 / 3 doubles while the engine played 10 / 90 / 5 / 4, and a Save
 * wrote them. The same projection reads `start` for the badge and Reset (ruling 51).
 */

import type { RulesStart } from '@myclash/types';
import type { LevelAtTimeChains } from '../new/_wizard/LevelAtTimeEditor';
import type { RulesFormSpec } from './useEffectiveRules';

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

/**
 * The form of `rules`: the three phases the screens show, picked by name, so a key they do not
 * show (a Swiss value) is never part of the form, nor of the PATCH.
 */
export function matchFormatForm(rules: RulesStart): WizardMatchFormat {
  const mf = rules.matchFormat;
  return {
    pointCap: mf.pointCap,
    timerMode: mf.timerMode,
    timeLimitsSeconds: {
      pool: mf.timeLimitsSeconds.pool,
      bracket: mf.timeLimitsSeconds.bracket,
      finals: mf.timeLimitsSeconds.finals,
    },
    softClockLimitSeconds: mf.softClockLimitSeconds,
    maxDoubleHits: mf.maxDoubleHits,
    maxDoubleHitOutcome: mf.maxDoubleHitOutcome,
    afterblowMode: rules.scoring.afterblowMode,
    scoringDirection: mf.scoringDirection,
    bestOf: { pool: mf.bestOf.pool, bracket: mf.bestOf.bracket, finals: mf.bestOf.finals },
    levelAtTime: {
      pool: mf.levelAtTime.pool,
      bracket: mf.levelAtTime.bracket,
      finals: mf.levelAtTime.finals,
    },
  };
}

/** The PATCH body of the whole form; `patchOf` keeps only what changed. */
export function matchFormatBody(form: WizardMatchFormat): Record<string, unknown> {
  const { afterblowMode, ...matchFormat } = form;
  return { rulesetConfig: { matchFormat }, scoringConfig: { afterblowMode } };
}

export const MATCH_FORMAT_FORM: RulesFormSpec<WizardMatchFormat> = {
  formOf: matchFormatForm,
  bodyOf: matchFormatBody,
};
