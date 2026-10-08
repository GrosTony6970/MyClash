import { isOwnSitePath } from '@myclash/types';

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
 * Accepts a path of our own site (`isOwnSitePath`, the one rule: `/x`, never
 * `//x` or `/\x`, which a browser reads as another site) or a same-origin
 * absolute URL whose path passes the same rule; rejects everything else. The
 * admin sends `window.location.href` (same-origin absolute).
 *
 * An absolute address is handed back as our origin plus its path, not as it
 * was written: `HTTPS://HOST/x` and `blob:https://host/x` have our origin too,
 * and the header picks a hard navigation by reading the href's first letters.
 */
export function safeReturnHref(raw: string | null, currentOrigin: string): string | null {
  if (!raw) return null;
  if (isOwnSitePath(raw)) return raw;
  try {
    const read = new URL(raw);
    const path = read.pathname + read.search + read.hash;
    return read.origin === currentOrigin && isOwnSitePath(path) ? currentOrigin + path : null;
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
 * The sign-in screen of the mount the pad is served under. Through the admin
 * proxy a bare `/login` would leave the pad for the admin app.
 */
export function signInPath(pathname: string): string {
  return `${staffRoutePrefix(pathname)}/login`;
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
 * is no external-display base.
 *
 * The base is read from `?externalDisplay=` and the result goes to
 * `window.open`, where a `javascript:` address runs on the pad's own site, and
 * the popup keeps a handle to the pad. So the result is a path of our own site
 * (`isOwnSitePath`, asked once the bout is swapped in) that the browser reads
 * as this bout's display page, or null, and the header then shows no button.
 * Every admin screen sends `/display/{id}`.
 */
export function displayUrlForMatch(
  externalDisplayUrl: string | null | undefined,
  matchId: string,
): string | null {
  if (!externalDisplayUrl) return null;
  const url = externalDisplayUrl.replace(/\/display\/[^/?#]+/, `/display/${matchId}`);
  if (!isOwnSitePath(url)) return null;
  // The path as the browser resolves it: `/display/x/../../api` is `/api`.
  // Handed back as it was read, not as it was written.
  const read = new URL(url, 'https://pad.invalid');
  return read.pathname === `/display/${matchId}` ? read.pathname + read.search + read.hash : null;
}
