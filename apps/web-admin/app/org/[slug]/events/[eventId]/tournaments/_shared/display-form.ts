/**
 * The Display form (the settings tab and wizard Step 3): side colours, scoring buttons, pinned
 * penalties (the tab only) and the protest limit (both, `ProtestLimitFields`), read from the scoring config in force the API answers (`effectiveRules.scoring`),
 * never from a default of its own (operator rulings 43, 46). It held a single `Point` and an
 * `Afterblow` button over the pad's +2/+1 and 2-1/1-1, and a Save wrote them.
 */

import { protestRulesOf, type TournamentScoringConfig } from '@myclash/types';
import type { RulesFormSpec } from './useEffectiveRules';

export interface CleanButton {
  label: string;
  value: number;
  visible: boolean;
}

export interface AfterblowButton {
  label: string;
  attackerPts: number;
  defenderPts: number;
  visible: boolean;
}

export interface DisplayState {
  sideColors: { red: string; blue: string };
  buttons: { clean: CleanButton[]; afterblow: AfterblowButton[] };
  /** Ruleset-entry ref_numbers pinned as scoreboard quick-pick chips. */
  quickPenalties: string[];
  /** The protest limit as typed: `''` is no limit. */
  protestLimit: string;
  /** The ref of the penalty offered past the limit; null: none. */
  protestOfferRef: string | null;
}

/** The form of a scoring config in force, each button picked by name. */
export function displayForm(scoring: TournamentScoringConfig): DisplayState {
  const protests = protestRulesOf(scoring.display);
  return {
    sideColors: { red: scoring.display.sideColors.red, blue: scoring.display.sideColors.blue },
    buttons: {
      clean: scoring.buttons.clean.map(({ label, value, visible }) => ({ label, value, visible })),
      afterblow: scoring.buttons.afterblow.map(({ label, attackerPts, defenderPts, visible }) => ({
        label,
        attackerPts,
        defenderPts,
        visible,
      })),
    },
    quickPenalties: [...(scoring.display.quickPenalties ?? [])],
    protestLimit: protests.limit === null ? '' : String(protests.limit),
    protestOfferRef: protests.offerPenaltyRef,
  };
}

/**
 * The protest limit as typed is one the API takes: empty (no limit), or a whole number of 0 or
 * more. The Save checks it first: the field's own `min` and `step` are never checked, as the Save
 * is a button and not a form submit.
 */
export const protestLimitValid = (limit: string): boolean => /^\d*$/.test(limit.trim());

/**
 * The PATCH body of the whole form; `patchOf` keeps only what changed. The limit is sent as a
 * number, and an empty limit as null; the server refuses one that is not a whole number of 0 or more.
 */
export function displayBody(form: DisplayState): Record<string, unknown> {
  const limit = form.protestLimit.trim();
  return {
    scoringConfig: {
      display: {
        sideColors: form.sideColors,
        quickPenalties: form.quickPenalties,
        protests: {
          limit: limit === '' ? null : Number(limit),
          offerPenaltyRef: form.protestOfferRef,
        },
      },
      buttons: form.buttons,
    },
  };
}

export const DISPLAY_FORM: RulesFormSpec<DisplayState> = {
  formOf: (rules) => displayForm(rules.scoring),
  bodyOf: displayBody,
};
