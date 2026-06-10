import type { TournamentSideColor } from '@myclash/types';

export interface SideColors {
  red: TournamentSideColor;
  blue: TournamentSideColor;
}

const DEFAULT_SIDE_COLORS: SideColors = { red: 'red', blue: 'blue' };

/**
 * The configured fighter-side colours from a tournament row, or the red/blue
 * default. Reads `scoring_config_json` — NOT `scoring_config`: that exact
 * field-name slip made the pool match pills (and once the Display tab) ignore
 * the tournament's configured colours and fall back to red/blue.
 */
export function parseSideColors(row: unknown): SideColors {
  const sideColors = (
    row as { scoring_config_json?: { display?: { sideColors?: Partial<SideColors> } } } | null
  )?.scoring_config_json?.display?.sideColors;
  return {
    red: sideColors?.red ?? DEFAULT_SIDE_COLORS.red,
    blue: sideColors?.blue ?? DEFAULT_SIDE_COLORS.blue,
  };
}
