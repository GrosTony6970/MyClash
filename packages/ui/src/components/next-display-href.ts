/**
 * Build the URL TVScoreboard auto-navigates to when the current match
 * ends (rollover). The web-public display uses the canonical
 * `/e/{eventSlug}/match/{id}/display` route; surfaces mounted elsewhere
 * (e.g. the admin same-origin `/display/{id}` popup) pass an `override`
 * so the rollover stays within their own routing.
 */
export function nextDisplayHref(
  eventSlug: string,
  nextMatchId: string,
  override?: (id: string) => string,
): string {
  return override ? override(nextMatchId) : `/e/${eventSlug}/match/${nextMatchId}/display`;
}
