/**
 * The public site's origin (web-public), for links the admin hands out: display screens, the
 * league page, the sign-in link, the photo QR code. The one reader of
 * `NEXT_PUBLIC_PUBLIC_APP_URL` in web-admin; four pages read it inline before.
 *
 * Same shape as `staff-url.ts`, for the same reasons: the key is read by its literal name so Next
 * inlines it at build time, and it is in `REQUIRED_PROD_ENV` (next.config.ts), so a production
 * build without it fails before this file runs. The inline reads fell back to the production
 * site, which only ever fired in local dev and sent its links to production. The fallback is now
 * local dev's own address (`.env.example`).
 */
function trimmed(value: string | undefined): string | undefined {
  if (typeof value !== 'string') return undefined;
  const v = value.trim();
  return v.length > 0 ? v : undefined;
}

/** Browser-reachable public-site origin, with no trailing slash. */
export function publicAppUrl(): string {
  const base = trimmed(process.env['NEXT_PUBLIC_PUBLIC_APP_URL']) ?? 'http://localhost:3001';
  return base.replace(/\/+$/, '');
}
