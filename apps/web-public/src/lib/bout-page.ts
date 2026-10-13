/**
 * The plain address of a bout's public page: what its Share button sends. A
 * person who gets the link has no page to go back to.
 */
export function boutPagePath(eventSlug: string, matchId: string): string {
  return `/e/${eventSlug}/match/${matchId}`;
}

/**
 * The address of a bout's public page, with the page its Back link returns to.
 * The ONE builder: the pool's list of bouts, the signed-in schedule and the
 * guest schedule all send a spectator there and want them back.
 */
export function boutPageHref(eventSlug: string, matchId: string, returnTo: string): string {
  return `${boutPagePath(eventSlug, matchId)}?return=${encodeURIComponent(returnTo)}`;
}

/**
 * What the bout page's Back link says, from the address it was given (already
 * checked as a path of our own site, or null):
 *
 * - none: the link goes to the Event home, and says so;
 * - a Tournament's page: its list of bouts;
 * - anything else (a schedule): a plain "Back". It said "Back to match list"
 *   for a fighter who came from their own schedule.
 */
export function backLabelKey(validReturn: string | null, eventSlug: string): string {
  if (validReturn === null) return 'publicApp.tournament.backToEventHome';
  return validReturn.startsWith(`/e/${eventSlug}/t/`)
    ? 'scoring.lice.backToMatchList'
    : 'actions.back';
}
