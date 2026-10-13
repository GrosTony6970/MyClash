/**
 * The address of one bout's own TV screen. The single-bout screen goes there
 * when its bout ends, by the app's router: a page that is LOADED leaves
 * fullscreen (quick win T5).
 */
export function boutDisplayHref(eventSlug: string, matchId: string): string {
  return `/e/${eventSlug}/match/${matchId}/display`;
}
