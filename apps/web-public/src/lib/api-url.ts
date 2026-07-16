/**
 * Resolve the API base URL for the public app.
 *
 * Two helpers, split by WHERE the value is allowed to be used. The name states
 * the constraint, because the value differs by execution context and that is
 * invisible at the call site:
 *
 * - `getServerApiUrl()` — SSR / route handlers only. Prefers `API_URL_INTERNAL`
 *   (`http://api:4000` in `infra/docker-compose.prod.yml`). The public hostname
 *   doesn't reliably hairpin from inside the Docker network — there it resolves
 *   to 127.0.0.1, which has no listener, producing Node's generic `fetch failed`.
 *   Server-side fetches must use the docker service name.
 * - `getPublicApiUrl()` — browser-reachable, safe on BOTH sides. Use this in
 *   client components, and for any URL that ends up in server-rendered HTML
 *   (`<a href>`, `<img src>`).
 *
 * The docker-internal host must never cross into the browser: it can't resolve
 * there, and plain `http://` is blocked as mixed content on an HTTPS page. The
 * `myclash/no-server-api-url-leak` lint rule enforces that `getServerApiUrl` is
 * neither imported by a `'use client'` file nor rendered into JSX.
 *
 * NEVER read `process.env['NEXT_PUBLIC_API_URL']` directly in `app/**` or
 * `src/**` — the ESLint guard in `apps/web-public/eslint.config.mjs` blocks it.
 */
/** Treat empty string as unset — guards against deployments that
 * accidentally set the var to '' (which `??` would otherwise let
 * through, silently breaking SSR routing). */
function trimmed(value: string | undefined): string | undefined {
  if (typeof value !== 'string') return undefined;
  const v = value.trim();
  return v.length > 0 ? v : undefined;
}

/**
 * SSR / route-handler ONLY — returns the docker-internal host in prod.
 *
 * Use for a server component's or route handler's own `await fetch`. Never pass
 * the result to a client component or render it into HTML; use
 * `getPublicApiUrl()` for anything the browser will touch.
 */
export function getServerApiUrl(): string {
  return (
    trimmed(process.env['API_URL_INTERNAL']) ??
    trimmed(process.env['NEXT_PUBLIC_API_URL']) ??
    'http://localhost:4000'
  );
}

/**
 * Browser-reachable API base URL, safe on BOTH sides — it has no
 * server/browser branch, so it returns the same value during the SSR pass of a
 * client component and in the browser (no hydration mismatch).
 */
export function getPublicApiUrl(): string {
  return trimmed(process.env['NEXT_PUBLIC_API_URL']) ?? 'http://localhost:4000';
}
