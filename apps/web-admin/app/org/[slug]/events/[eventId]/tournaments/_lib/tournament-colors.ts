/**
 * Shared 16-swatch palette for tournament identity color (the pill
 * shown next to a tournament's name across the admin UI).
 *
 * Used by:
 *   - The new-tournament wizard's Step 1 Basics (color picker).
 *   - The settings page Display tab.
 *   - The tournaments table's pill-class-for helper.
 *
 * Keep in sync with the ColorToken palette in
 * packages/ui/src/utils/color-token.ts so TournamentColorDot can
 * render every entry.
 */
export const TOURNAMENT_COLORS = [
  'red',
  'blue',
  'green',
  'amber',
  'violet',
  'teal',
  'orange',
  'purple',
  'yellow',
  'gold',
  'silver',
  'bronze',
  'slate',
  'black',
  'white',
] as const;

export type TournamentColor = (typeof TOURNAMENT_COLORS)[number];
