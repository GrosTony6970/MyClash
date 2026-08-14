/**
 * The public app's own origin, for absolute URLs the app has to emit.
 *
 * A sitemap, a `robots.txt` `Sitemap:` line and a `<link rel="canonical">` all
 * have to be absolute, and none of them has a request to derive the host from:
 * `sitemap.ts` and `robots.ts` run without one, and a canonical built from a
 * proxied request header is whatever the last hop claimed. So the origin is
 * configuration, not inference.
 *
 * SERVER ONLY, deliberately. The name has no `NEXT_PUBLIC_` prefix, so Next
 * never inlines it into a browser bundle — which also means it needs no
 * Dockerfile `ARG`, no compose `build.args` entry, and no image rebuild when it
 * changes. It is set in the `environment:` block of both compose files, exactly
 * like `API_URL_INTERNAL` (see `src/lib/api-url.ts`). Reading it from a client
 * component returns `undefined` and silently falls back to localhost; if you
 * need an origin in the browser, use `window.location.origin`.
 */

/**
 * Treat empty string as unset. Same guard as `api-url.ts`: a deployment that
 * sets the var to `''` would otherwise pass `??` and produce `https:///sitemap`
 * style URLs rather than falling back to something that works.
 */
function trimmed(value: string | undefined): string | undefined {
  if (typeof value !== 'string') return undefined;
  const v = value.trim();
  return v.length > 0 ? v : undefined;
}

/**
 * Absolute origin of this app, with no trailing slash.
 *
 * Prod is `https://app.${DOMAIN}`; dev-in-Docker is `https://myclash.localhost`
 * (the apex host, not an `app.` subdomain — see the `dev-public` Traefik
 * router). The localhost default matches `next dev`'s port for this app, so a
 * developer who has set nothing still gets working absolute URLs rather than a
 * crash inside `new URL()`.
 */
export function getAppOrigin(): string {
  const raw = trimmed(process.env['PUBLIC_APP_ORIGIN']) ?? 'http://localhost:3001';
  return raw.replace(/\/+$/, '');
}
