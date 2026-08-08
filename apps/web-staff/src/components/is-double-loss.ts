/**
 * A finished match where the double cap was hit — both fighters lose, no
 * winner. The ruleset zeroes both scores server-side when
 * `doubleCount >= maxDoubleHits` and completes the match; this predicate
 * lets the referee pad render the "DOUBLE LOSS" state from data it already
 * has (status + live double count + the configured cap).
 *
 * A null `maxDoubleHits` means "no cap" → never a double loss.
 */
export function isDoubleLoss(
  matchStatus: string,
  doubleCount: number,
  maxDoubleHits: number | null,
): boolean {
  return matchStatus === 'completed' && maxDoubleHits !== null && doubleCount >= maxDoubleHits;
}
