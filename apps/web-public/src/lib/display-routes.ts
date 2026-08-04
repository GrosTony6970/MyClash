/**
 * The projector / kiosk routes of this app.
 *
 * They are chromeless by design (`docs/design/display-kiosk.md`): no SiteHeader,
 * no legal footer, nothing that belongs to a page rather than to a screen on a
 * wall. Both the header and the footer used to carry their own copy of this
 * list, and they disagreed — the per-lice route kept rendering the spectator
 * "Sign in" button, which is the wrong door for the staff who open these URLs.
 * One list, two consumers.
 */
const DISPLAY_ROUTES = [
  /^\/e\/[^/]+\/match\/[^/]+\/display\/?$/,
  /^\/e\/[^/]+\/lice\/[^/]+\/display\/?$/,
];

export function isDisplayRoute(path: string | null | undefined): boolean {
  if (!path) return false;
  return DISPLAY_ROUTES.some((route) => route.test(path));
}
