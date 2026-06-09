/**
 * Navigation helpers for the scoring pad, which is mounted at two base
 * paths from one build:
 *   - scoring.${DOMAIN}/        — referee root (PWA / bookmarks)
 *   - admin.${DOMAIN}/scoring/* — admin same-origin proxy (Traefik strips
 *     /scoring; keeps the admin session cookie). See
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
 * The route prefix the scoring app is mounted under: `/scoring` when
 * served via the admin same-origin proxy, `''` on the canonical scoring
 * subdomain (root mount). In-app navigation hrefs must be prefixed with
 * this so they don't escape the `/scoring` mount and hit the admin app.
 */
export function scoringRoutePrefix(pathname: string): string {
  return pathname.startsWith('/scoring') ? '/scoring' : '';
}

/**
 * `window.open` feature string for the external-display scoreboard
 * popup: a sized, resizable, chromeless second-screen window the
 * operator can drag onto a projector.
 */
export function scoreboardPopupFeatures(width = 1280, height = 720): string {
  return `popup=yes,width=${width},height=${height},resizable=yes,scrollbars=no`;
}

/** Open the external-display scoreboard as a sized popup window. */
export function openScoreboardPopup(url: string): void {
  window.open(url, 'myclash-scoreboard', scoreboardPopupFeatures());
}
