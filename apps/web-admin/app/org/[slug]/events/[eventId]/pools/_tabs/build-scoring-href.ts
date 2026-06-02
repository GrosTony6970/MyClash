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

/**
 * Build the cross-app URL into the web-scoring app's per-match
 * ScoringPad, used as the deep-link fallback when the bracket /
 * pools tabs don't have a lice yet. Lands on `/matches/{matchId}`
 * which fetches the match by id without a lice context.
 *
 * `returnTo` is the admin URL the operator clicked from — the
 * per-match scoring page surfaces it via `?return=` so its back
 * button still works after a hard refresh (when `router.back()`
 * alone would have nothing to return to).
 */
export function buildMatchScoringHref(
  scoringBaseUrl: string,
  matchId: string | null,
  returnTo?: string | null,
): string | null {
  if (!matchId) return null;
  const trimmed = scoringBaseUrl.replace(/\/+$/, '');
  const base = `${trimmed}/matches/${matchId}`;
  if (!returnTo) return base;
  return `${base}?return=${encodeURIComponent(returnTo)}`;
}
