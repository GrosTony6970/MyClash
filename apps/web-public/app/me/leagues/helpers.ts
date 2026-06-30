/** Shared formatting for the personal-space leagues surface. */

/** Medal glyph for a podium rank; empty string otherwise. */
export function rankMedal(rank: number): string {
  if (rank === 1) return '🥇';
  if (rank === 2) return '🥈';
  if (rank === 3) return '🥉';
  return '';
}

/** A `ranking_group_key` is a weapon or `weapon::category`. Render it readably:
 *  'sabre' → 'Sabre', 'sabre::mixed' → 'Sabre · Mixed'. */
export function formatGroup(key: string): string {
  return key
    .split('::')
    .map((part) => (part ? part.charAt(0).toUpperCase() + part.slice(1) : part))
    .join(' · ');
}
