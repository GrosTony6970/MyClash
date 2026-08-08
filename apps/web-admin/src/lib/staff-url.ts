/**
 * The staff app's origin — the ONE door where an event PIN works.
 *
 * Mirrors `apps/web-public/src/lib/staff-url.ts` deliberately, same name and
 * same shape, because it answers the same question in a second app. It is
 * duplicated rather than shared for the reason stated in that file: Next
 * inlines only a LITERAL `process.env['NEXT_PUBLIC_…']` read at build time, and
 * a shared module read from two apps would be inlined against whichever app
 * built it.
 *
 * ── Why there is no production fallback ─────────────────────────────────────
 * The staff page used to read the env inline and fall back to a hardcoded
 * `https://staff.myclash.fr`. That fallback could only ever fire when the
 * deployment was already misconfigured, and it turned a loud failure into a
 * quiet one: every sign-in link and QR code on the page would render against
 * whatever host was compiled in months earlier. `NEXT_PUBLIC_STAFF_URL` is in
 * `REQUIRED_PROD_ENV` (next.config.ts), so a missing value fails `next build`
 * before this file runs. The localhost fallback below is for local dev only —
 * production never reaches it.
 */
function trimmed(value: string | undefined): string | undefined {
  if (typeof value !== 'string') return undefined;
  const v = value.trim();
  return v.length > 0 ? v : undefined;
}

/** Browser-reachable staff-app origin, with no trailing slash. */
export function getStaffUrl(): string {
  const base = trimmed(process.env['NEXT_PUBLIC_STAFF_URL']) ?? 'http://localhost:3002';
  return base.replace(/\/+$/, '');
}
