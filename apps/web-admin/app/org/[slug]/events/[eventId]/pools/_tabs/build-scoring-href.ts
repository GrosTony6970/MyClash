/**
 * Build the cross-app URL into the web-scoring app's lice-queue
 * page (`/lices/{liceId}`). The lice page shows the lice's current
 * top-of-queue match plus its upcoming queue — the right surface
 * for an operator stationed at a strip all day.
 *
 * NOT used for "I clicked a specific match" navigation — that goes
 * through `buildMatchScoringHref` so the operator lands on the
 * exact match they clicked, regardless of which match the lice
 * happens to have at the top of its queue.
 *
 * Returns `null` when no liceId is provided.
 */
export function buildScoringHref(scoringBaseUrl: string, liceId: string | null): string | null {
  if (!liceId) return null;
  const trimmed = scoringBaseUrl.replace(/\/+$/, '');
  return `${trimmed}/lices/${liceId}`;
}

/**
 * Build the cross-app URL into the web-scoring app's per-match
 * ScoringPad. **Primary** deep-link from any specific match click in
 * the admin (bracket, pools, schedule grid) — lands on
 * `/matches/{matchId}` which fetches the match by id without a lice
 * context, so the operator always sees the exact match they clicked.
 *
 * `returnTo` is the admin URL the operator clicked from — the
 * per-match scoring page surfaces it via `?return=` so its back
 * button still works after a hard refresh (when `router.back()`
 * alone would have nothing to return to).
 *
 * TODO: dormant. All admin match clicks now route to the same-origin
 * admin scoreboard at
 * `/org/<slug>/events/<eventId>/matches/<matchId>/scoreboard` because
 * the cross-origin scoring.myclash.fr fetch fails the dev cert. This
 * helper stays for a future explicit "Open in tablet PWA" affordance.
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
