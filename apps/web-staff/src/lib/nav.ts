/**
 * Navigation helpers for the staff app, which is mounted at two base
 * paths from one build:
 *   - staff.${DOMAIN}/          — staff root (PWA / bookmarks)
 *   - admin.${DOMAIN}/staff/*   — admin same-origin proxy (Traefik strips
 *     /staff; keeps the admin session cookie). See
 *     infra/docker-compose.prod.yml.
 *
 * The app has no Next `basePath` (it would be build-time-static, but the
 * correct prefix differs by host), so in-app navigation must be made
 * prefix-aware at runtime.
 */

/**
 * Validate a `?return=` value before using it as a back-link href.
 * Accepts a root-relative path (`/x`, not the protocol-relative `//x`) or
 * a same-origin absolute URL; rejects everything else (open-redirect
 * hygiene). The admin sends `window.location.href` (same-origin absolute).
 */
export function safeReturnHref(raw: string | null, currentOrigin: string): string | null {
  if (!raw) return null;
  if (raw.startsWith('/') && !raw.startsWith('//')) return raw;
  try {
    return new URL(raw).origin === currentOrigin ? raw : null;
  } catch {
    return null;
  }
}

/**
 * The route prefix the staff app is mounted under: `/staff` when served via
 * the admin same-origin proxy, `''` on the canonical staff subdomain (root
 * mount). In-app navigation hrefs must be prefixed with this so they don't
 * escape the `/staff` mount and hit the admin app.
 *
 * Must stay in step with THREE things in infra/docker-compose.prod.yml — the
 * two stripprefix middlewares and the `STAFF_ASSET_PREFIX` build arg. They are
 * the same prefix seen from the edge, the build, and the client.
 */
export function staffRoutePrefix(pathname: string): string {
  return pathname.startsWith('/staff') ? '/staff' : '';
}

/**
 * Whether a back-link href points OUT of the web-staff app (an absolute
 * http(s) URL — typically the admin `?return=` target on the same origin but
 * a different app behind the proxy). Such hrefs must be a native `<a>` hard
 * navigation: a Next `<Link>` would client-route them inside web-staff,
 * which has no `/org/...` route. Root-relative paths stay in-app (Next Link).
 */
export function isExternalHref(href: string | null | undefined): boolean {
  return !!href && /^https?:\/\//.test(href);
}

/**
 * `window.open` feature string for the external-display scoreboard
 * popup: a sized, resizable, chromeless second-screen window the
 * operator can drag onto a projector.
 */
export function scoreboardPopupFeatures(width = 1280, height = 720): string {
  return `popup=yes,width=${width},height=${height},resizable=yes,scrollbars=no`;
}

const SCOREBOARD_WINDOW_NAME = 'myclash-scoreboard';

// Handle to the external-display popup this tab opened, so a later match
// switch can retarget it instead of spawning a second window. Module-scoped
// so it survives client-side route changes between /matches/[id] pages.
let scoreboardPopup: Window | null = null;

/** Open the external-display scoreboard as a sized popup window. */
export function openScoreboardPopup(url: string): void {
  scoreboardPopup = window.open(url, SCOREBOARD_WINDOW_NAME, scoreboardPopupFeatures());
}

/**
 * Retarget an already-open scoreboard popup to a new match's display URL.
 * No-op when the operator never opened the popup (or closed it) — we never
 * auto-spawn a window, which would fight popup blockers and surprise the
 * operator. Re-`window.open`-ing the same named same-origin window navigates
 * the existing popup rather than opening a new one, so the projection follows
 * whatever match the pad is showing.
 */
export function retargetScoreboardPopupIfOpen(url: string): void {
  if (!scoreboardPopup || scoreboardPopup.closed) return;
  scoreboardPopup = window.open(url, SCOREBOARD_WINDOW_NAME, scoreboardPopupFeatures());
}

/**
 * Swap the match-id segment of an external-display URL (`/display/{id}` — see
 * build-scoring-href.ts) for the currently-viewed match, so the ↗ button and
 * the retarget both point at what the pad is showing. Returns null when there
 * is no external-display base; leaves a URL without a `/display/{id}` segment
 * untouched.
 */
export function displayUrlForMatch(
  externalDisplayUrl: string | null | undefined,
  matchId: string,
): string | null {
  if (!externalDisplayUrl) return null;
  return externalDisplayUrl.replace(/\/display\/[^/?#]+/, `/display/${matchId}`);
}
