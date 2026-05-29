/**
 * Build the cross-app URL into the web-scoring app's ScoringPad for a
 * given match's lice. The match row stores `lice_id` already (drives
 * the inline Lice picker); we just need the scoring app's origin to
 * land on `/lices/{liceId}`.
 *
 * Returns `null` when the match has no lice assigned — the caller
 * disables the row click in that case so the operator picks a lice
 * first.
 */
export function buildScoringHref(scoringBaseUrl: string, liceId: string | null): string | null {
  if (!liceId) return null;
  const trimmed = scoringBaseUrl.replace(/\/+$/, '');
  return `${trimmed}/lices/${liceId}`;
}
