/**
 * The Display form (the settings tab and wizard Step 3): side colours, scoring buttons and pinned
 * penalties, read from the scoring config in force the API answers (`effectiveRules.scoring`),
 * never from a default of its own (operator rulings 43, 46). It held a single `Point` and an
 * `Afterblow` button over the pad's +2/+1 and 2-1/1-1, and a Save wrote them.
 */

import type { TournamentScoringConfig } from '@myclash/types';
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
  quickPenalties: number[];
}

/** The form of a scoring config in force, each button picked by name. */
export function displayForm(scoring: TournamentScoringConfig): DisplayState {
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
  };
}

/** The PATCH body of the whole form; `patchOf` keeps only what changed. */
export function displayBody(form: DisplayState): Record<string, unknown> {
  return {
    scoringConfig: {
      display: { sideColors: form.sideColors, quickPenalties: form.quickPenalties },
      buttons: form.buttons,
    },
  };
}

export const DISPLAY_FORM: RulesFormSpec<DisplayState> = {
  formOf: (rules) => displayForm(rules.scoring),
  bodyOf: displayBody,
};
