/**
 * Resolve the API base URL for the public app.
 *
 * - **Server-side (SSR, route handlers, server components):** prefer
 *   `API_URL_INTERNAL` (set to `http://api:4000` in
 *   `infra/docker-compose.prod.yml`). The public hostname
 *   `https://api.myclash.fr` doesn't reliably hairpin from inside the
 *   Docker network — inside the container it resolves to 127.0.0.1
 *   which has no listener, producing Node's generic `fetch failed`.
 *   Server-side fetches must use the docker service name.
 * - **Client-side (browser):** use `NEXT_PUBLIC_API_URL` (the public
 *   hostname). Next.js inlines this at build time, so the browser
 *   bundle ships with the public URL baked in.
 *
 * `typeof window === 'undefined'` is the canonical
 * server-vs-browser discriminator inside React server components.
 *
 * NEVER read `process.env['NEXT_PUBLIC_API_URL']` directly anywhere
 * in `apps/web-public/app/**`. The ESLint guard in
 * `apps/web-public/.eslintrc.json` blocks it.
 */
/** Treat empty string as unset — guards against deployments that
 * accidentally set the var to '' (which `??` would otherwise let
 * through, silently breaking SSR routing). */
function trimmed(value: string | undefined): string | undefined {
  if (typeof value !== 'string') return undefined;
  const v = value.trim();
  return v.length > 0 ? v : undefined;
}

export function getApiUrl(): string {
  if (typeof window === 'undefined') {
    return (
      trimmed(process.env['API_URL_INTERNAL']) ??
      trimmed(process.env['NEXT_PUBLIC_API_URL']) ??
      'http://localhost:4000'
    );
  }
  return trimmed(process.env['NEXT_PUBLIC_API_URL']) ?? 'http://localhost:4000';
}

/**
 * Browser-reachable API base URL, safe on BOTH sides. Use this for URLs that
 * end up in rendered HTML (`<a href>`, `<img src>`) from server components —
 * `getApiUrl()` would leak the docker-internal `http://api:4000` host into
 * the page there (the SSR client-URL-leak gotcha).
 */
export function getPublicApiUrl(): string {
  return trimmed(process.env['NEXT_PUBLIC_API_URL']) ?? 'http://localhost:4000';
}
