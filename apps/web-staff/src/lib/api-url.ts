/**
 * Resolve the base URL for `/api/v1/*` fetches.
 *
 * - In a browser: returns `''` so fetches are relative to the current
 *   origin. This lets the scoring bundle work both at its own
 *   origin (staff.myclash.fr) and behind a same-origin reverse proxy
 *   (e.g. admin.myclash.fr/scoring/*), without rebuilding.
 * - On the server (SSR/tests): falls back to the build-time env var
 *   or localhost so SSR fetches and unit tests keep working.
 *
 * A Server Component that has to hand the base URL to a client component uses
 * `BROWSER_API_BASE` below — see its docstring for why neither `getApiUrl()`
 * nor a `'use client'` wrapper works there.
 *
 * ── Why a module-scope read is still statically inlined ─────────────────────
 * Next inlines `process.env.NEXT_PUBLIC_FOO` / `process.env['NEXT_PUBLIC_FOO']`
 * — a LITERAL property access — at build time, in the server compilation as
 * well as the browser one. A dynamic `process.env[someVariable]` is NOT
 * inlined and reads `undefined` in the browser; that is what made the retired
 * `requireClientEnv()` helper take its failure branch in every production call
 * and killed /pools and /bracket on 2026-06-02. Keep the access below literal.
 *
 * NEVER read `process.env['NEXT_PUBLIC_API_URL']` directly in `app/**` or
 * `src/**` — the ESLint guard in `apps/web-staff/eslint.config.mjs` blocks it.
 */

/**
 * Treat an empty string as unset. `next build` already rejects an absent OR
 * empty `NEXT_PUBLIC_API_URL` through `REQUIRED_PROD_ENV` in next.config.ts
 * (`!process.env[name]` is true for `''`), so this catches the one value that
 * survives that check and still defeats `??`: whitespace only.
 *
 * Byte-identical to the copy in web-admin and web-public. Deliberately not
 * extracted: four pure lines, six identical copies, zero drift — cheaper here
 * than a workspace package on three apps' build graph.
 */
function trimmed(value: string | undefined): string | undefined {
  if (typeof value !== 'string') return undefined;
  const v = value.trim();
  return v.length > 0 ? v : undefined;
}

/**
 * Same-origin. The pad's one browser policy: the scoring bundle must work at
 * staff.${DOMAIN} AND behind admin.${DOMAIN}/staff/* without a rebuild, so
 * every browser fetch is relative and Traefik routes `/api/v1/*` to the API on
 * whichever host the page was loaded from (`myclash-staff-api` and
 * `myclash-admin-api` in infra/docker-compose.prod.yml).
 *
 * Exported for `app/layout.tsx`, which renders the shared MaintenanceBanner and
 * needs the browser base in a Server Component. Both other ways of getting it
 * there are wrong, which is why this constant exists:
 *
 *   - `getApiUrl()` branches on `typeof window`, so from a Server Component it
 *     returns the SERVER value and ships it to the browser. That is what the
 *     layout did (via a direct env read): it baked the absolute host in — Next
 *     inlines the literal in the server compilation too, so the `?? ''` beside
 *     it never ran — and made the banner the only request in the PWA leaving
 *     the current origin. Rejected by that host's cert, swallowed by
 *     `useRuntimeFlags`' catch, banner silently never shown.
 *   - A `'use client'` wrapper (web-admin's and web-public's
 *     `app/_components/RuntimeBanner.tsx`) is the fix in those apps but does not
 *     port: the wrapper imports `@myclash/ui`, which is CJS with a single `"."`
 *     export and 75 eager `require`s in its barrel, so a client module importing
 *     it pulls the whole package into the root-layout client graph — on the
 *     offline-first pad, of all apps.
 */
export const BROWSER_API_BASE = '';

export function getApiUrl(): string {
  if (typeof window !== 'undefined') return BROWSER_API_BASE;
  return trimmed(process.env['NEXT_PUBLIC_API_URL']) ?? 'http://localhost:4000';
}
