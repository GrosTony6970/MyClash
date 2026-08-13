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
 * ── Why the browser half is also exported as a constant ─────────────────────
 * The pad's browser policy is a constant, not a computed value, so a Server
 * Component that has to hand the base URL to a client component can use
 * `BROWSER_API_BASE` directly instead of reading the env var. That is not a
 * shortcut — it is the only shape that keeps the policy in one file here:
 *
 *   - `getApiUrl()` branches on `typeof window`, so calling it from a Server
 *     Component returns the SERVER value and ships it to the browser. That is
 *     exactly the bug class `eslint-rules/no-server-api-url-leak.mjs` exists
 *     for in web-public.
 *   - Wrapping the consumer in a `'use client'` component (web-admin's and
 *     web-public's `app/_components/RuntimeBanner.tsx`) is the fix there, but
 *     it does not port: those wrappers import `@myclash/ui`, which is CJS with
 *     a single `"."` export and 75 eager `require`s in its barrel. A client
 *     module importing it pulls the whole package into the root-layout client
 *     graph — on the offline-first pad, of all apps.
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
 */
export const BROWSER_API_BASE = '';

export function getApiUrl(): string {
  if (typeof window !== 'undefined') return BROWSER_API_BASE;
  return trimmed(process.env['NEXT_PUBLIC_API_URL']) ?? 'http://localhost:4000';
}
