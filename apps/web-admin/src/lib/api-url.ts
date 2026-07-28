/**
 * Resolve the API base URL for the admin app.
 *
 * One owner for a value that was copy-pasted 121 times as
 * `process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000'`, with three
 * sites quietly disagreeing: two fell back to `''` and one had no fallback at
 * all (rendering the literal string `undefined` into a fetch URL).
 *
 * ── Why there is no getServerApiUrl() here ──────────────────────────────────
 * web-public splits this into `getServerApiUrl()` (docker-internal
 * `API_URL_INTERNAL`, SSR only) and `getPublicApiUrl()` (browser-reachable),
 * because the internal host cannot resolve in a browser and plain `http://` is
 * blocked as mixed content on an HTTPS page. web-admin has no server-side
 * fetches — 123 of the 130 files reading this value are `'use client'` — so it
 * has a single browser-facing URL and needs only that half.
 *
 * If this app ever grows an SSR fetch, port web-public's split rather than
 * widening this helper: the same-named function returning different values by
 * context is what made the old shared `getApiUrl()` unsafe, since "is this
 * value allowed here?" stopped being answerable from one file.
 * See `apps/web-admin/app/_components/RuntimeBanner.tsx`, which already carries
 * that warning.
 *
 * ── Why a module-scope read is still statically inlined ─────────────────────
 * Next inlines `process.env.NEXT_PUBLIC_FOO` / `process.env['NEXT_PUBLIC_FOO']`
 * — a LITERAL property access — into the browser bundle at build time. A
 * dynamic `process.env[someVariable]` is NOT inlined and always reads
 * `undefined` in the browser. The retired `requireClientEnv()` helper was
 * originally written with a dynamic lookup and so degraded every production
 * call to its failure branch, which is how /pools and /bracket died on
 * 2026-06-02. Keep the access below literal.
 */

/**
 * Treat an empty string as unset. A deployment that sets the var to `''` would
 * otherwise pass `??` and produce relative URLs against the admin origin, which
 * has no API mounted.
 */
function trimmed(value: string | undefined): string | undefined {
  if (typeof value !== 'string') return undefined;
  const v = value.trim();
  return v.length > 0 ? v : undefined;
}

/**
 * Browser-reachable API base URL. No server/browser branch, so the SSR pass of
 * a client component and the browser agree — no hydration mismatch.
 *
 * Missing in production is already a build failure: `NEXT_PUBLIC_API_URL` is
 * listed in `REQUIRED_PROD_ENV` in `next.config.ts`, so `next build` exits
 * non-zero before this fallback can matter. The fallback is for local dev.
 */
export function getPublicApiUrl(): string {
  return trimmed(process.env['NEXT_PUBLIC_API_URL']) ?? 'http://localhost:4000';
}
