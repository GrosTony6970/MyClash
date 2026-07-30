import type { TournamentSideColor } from '@myclash/types';

export interface SideColors {
  red: TournamentSideColor;
  blue: TournamentSideColor;
}

export const DEFAULT_SIDE_COLORS: SideColors = { red: 'red', blue: 'blue' };

/**
 * The configured fighter-side colour TOKENS from a tournament's
 * `scoring_config_json`, or the red/blue default. Mirrors the admin
 * pool-matches table (parse-side-colors.ts) so the public surface
 * renders the same accent-bar colours. Returns tokens (e.g. 'red',
 * 'black', 'purple') — the client resolves them to hex via `sideStyle`.
 *
 * Pure: no I/O.
 */
export function sideColorsFromScoringConfig(scoringConfigJson: unknown): SideColors {
  const sideColors = (
    scoringConfigJson as { display?: { sideColors?: Partial<SideColors> } } | null | undefined
  )?.display?.sideColors;
  return {
    red: sideColors?.red ?? DEFAULT_SIDE_COLORS.red,
    blue: sideColors?.blue ?? DEFAULT_SIDE_COLORS.blue,
  };
}
