/**
 * scoring-config.ts — Tournament scoring configuration types
 *
 * Shared between API, scoring app, and admin app.
 */

export type AfterblowMode = 'full' | 'deductive';

export interface CleanButton {
  /** Display label, e.g. "+2" */
  label: string;
  /** Points awarded to the striker */
  value: number;
  /** Whether this button is shown in the scoring UI */
  visible: boolean;
}

export interface AfterblowButton {
  /** Display label, e.g. "2-1" */
  label: string;
  /** Points awarded to the first striker (attacker) */
  attackerPts: number;
  /**
   * Points awarded to the defender.
   * In 'deductive' mode this is ignored — defender always gets 0.
   */
  defenderPts: number;
  /** Whether this button is shown in the scoring UI */
  visible: boolean;
}

export interface ScoringButtonConfig {
  clean: CleanButton[];
  afterblow: AfterblowButton[];
}

export interface TournamentScoringConfig {
  /** How afterblow points are applied */
  afterblowMode: AfterblowMode;
  /** Configurable score entry buttons */
  buttons: ScoringButtonConfig;
}

/** Default config — matches TF_v1 standard */
export const DEFAULT_SCORING_CONFIG: TournamentScoringConfig = {
  afterblowMode: 'full',
  buttons: {
    clean: [
      { label: '+2', value: 2, visible: true },
      { label: '+1', value: 1, visible: true },
    ],
    afterblow: [
      { label: '2-1', attackerPts: 2, defenderPts: 1, visible: true },
      { label: '1-1', attackerPts: 1, defenderPts: 1, visible: true },
    ],
  },
};

/**
 * Compute the actual score deltas for an afterblow exchange,
 * respecting the afterblow mode.
 */
export function computeAfterblowDeltas(
  mode: AfterblowMode,
  attackerPts: number,
  defenderPts: number,
): { attackerDelta: number; defenderDelta: number } {
  return {
    attackerDelta: attackerPts,
    defenderDelta: mode === 'deductive' ? 0 : defenderPts,
  };
}
