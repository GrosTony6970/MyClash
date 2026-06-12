/**
 * Winner of an ended match: the side with the highest score, null on a
 * tie. Mirrors the TVScoreboard's winner logic so the pad's end-of-match
 * overlay and the external display agree. Tiebreak rules are a
 * ruleset-level concern and intentionally not applied here.
 *
 * Pure: no React, no I/O.
 */
export function matchWinnerSide(redScore: number, blueScore: number): 'red' | 'blue' | null {
  if (redScore > blueScore) return 'red';
  if (blueScore > redScore) return 'blue';
  return null;
}
