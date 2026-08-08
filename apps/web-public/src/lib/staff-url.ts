/**
 * The staff app's origin — the ONE door where an event PIN works.
 *
 * The public app's own Sign in is the spectator/competitor login and can never
 * produce a staff session, so every staff-facing affordance in this app (the
 * display hub, the kiosk control layer) links here instead.
 *
 * Single reader of `NEXT_PUBLIC_STAFF_URL` on purpose: Next inlines only a
 * LITERAL `process.env['NEXT_PUBLIC_…']` read at build time, so spreading the
 * lookup around is how it silently becomes `undefined` in one place. The var is
 * declared in `apps/web-public/next.config.ts` (REQUIRED_PROD_ENV), the app
 * Dockerfile and both compose files.
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

/**
 * The staff sign-in link for an event: the staff app's PIN form with the event
 * already filled in, so a referee only types their username and PIN.
 */
export function getStaffLoginUrl(eventSlug: string): string {
  return `${getStaffUrl()}/login?event=${encodeURIComponent(eventSlug)}`;
}
