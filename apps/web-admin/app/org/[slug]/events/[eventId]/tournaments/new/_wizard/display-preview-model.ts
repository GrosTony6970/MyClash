/**
 * View-model for the step-3 display SAMPLE: resolve each side-colour token to
 * its shared scoreboard style (`sideStyle`) and keep only the VISIBLE scoring
 * buttons. Afterblow buttons only apply to the TF_v1 ruleset (mirrors the
 * step's own gate). Pure — no React, no I/O — so it's unit-testable and the
 * preview renders straight from form state.
 */
import { sideStyle, type SideColorStyle } from '@myclash/ui';
import { DEFAULT_SCORING_CONFIG, type TournamentSideColor } from '@myclash/types';
import type { AfterblowButton, CleanButton } from './buildDisplayConfigFromRow';

export interface DisplayPreviewInput {
  sideColors: { red: string; blue: string };
  buttons: { clean: CleanButton[]; afterblow: AfterblowButton[] };
  rulesetCode: string;
}

export interface DisplayPreviewModel {
  red: SideColorStyle;
  blue: SideColorStyle;
  cleanButtons: CleanButton[];
  afterblowButtons: AfterblowButton[];
}

export function displayPreviewModel(input: DisplayPreviewInput): DisplayPreviewModel {
  const config = {
    ...DEFAULT_SCORING_CONFIG,
    display: {
      ...DEFAULT_SCORING_CONFIG.display,
      sideColors: input.sideColors as { red: TournamentSideColor; blue: TournamentSideColor },
    },
  };
  return {
    red: sideStyle(config, 'red'),
    blue: sideStyle(config, 'blue'),
    cleanButtons: input.buttons.clean.filter((b) => b.visible),
    afterblowButtons:
      input.rulesetCode === 'TF_v1' ? input.buttons.afterblow.filter((b) => b.visible) : [],
  };
}
