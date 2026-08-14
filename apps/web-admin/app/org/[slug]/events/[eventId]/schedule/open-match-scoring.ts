import { buildMatchScoringHref, STAFF_APP_PREFIX } from '../pools/_tabs/build-scoring-href';

/**
 * Ctrl/⌘-click on a match card (placed grid card OR unscheduled
 * chip) opens the same-origin proxied scoring view for **that
 * specific match**. Plain click is reserved for drag-and-drop
 * selection. The scoring route works for both pool and bracket
 * matches without needing lice/phase branching.
 *
 * `externalDisplay` carries the admin's read-only scoreboard URL so
 * the operator can throw the projection on a second monitor in one
 * click. Same-origin via Traefik `/scoring/*` avoids the dev-cert
 * prompt that blocks cross-origin staff.myclash.fr.
 */
export function openMatchScoring(slug: string, eventId: string, matchId: string): void {
  // Full-bleed external display (no admin shell), opened as a popup
  // from the scoring pad. `slug`/`eventId` are no longer needed for the
  // display URL but kept in the signature for call-site compatibility.
  void slug;
  void eventId;
  const scoreboardHref = `/display/${matchId}`;
  const href = buildMatchScoringHref(
    STAFF_APP_PREFIX,
    matchId,
    window.location.href,
    scoreboardHref,
  );
  if (href) window.location.href = href;
}
