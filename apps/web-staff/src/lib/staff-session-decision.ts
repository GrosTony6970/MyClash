import type { MeSession } from '@myclash/api-client';

/**
 * May this browser open the scoring pad?
 *
 * Two ways in, and the pad has always meant to accept both:
 *   1. a staff PIN session — `/api/v1/staff-auth/me`, the shared-tablet path;
 *   2. a full account session — `/api/v1/me` with `type: 'claimed'`, the
 *      organiser who runs a piste from their own laptop.
 *
 * ── The second one had never worked ─────────────────────────────────────────
 * `lices/page.tsx` asked for `me.type !== 'user'` behind a `{ type: string }`
 * cast. `/me` answers `claimed`, `guest` or `anonymous` and never has — the
 * value `'user'` does not appear anywhere in `auth.service.ts`. So the fallback
 * could not pass, and every organiser without a PIN was sent to /login while
 * holding a perfectly good session. The bare `string` in the cast is what hid
 * it: nothing could compare the literal against the real union.
 *
 * Extracted here rather than fixed in place because `web-staff` has no React
 * test setup — no `.test.tsx`, no testing-library — so a gate living inside a
 * component is a gate nothing can assert. `MeSession` carries the other half:
 * the old literal no longer type-checks.
 */
export type StaffSessionDecision =
  /** Open the pad. */
  | { kind: 'allow' }
  /** No usable session of either kind. */
  | { kind: 'sign_in' };

export function resolveStaffSession(
  /** `/api/v1/staff-auth/me` answered 2xx — a PIN session on this tablet. */
  hasStaffPinSession: boolean,
  /** The `/api/v1/me` body, or null when it could not be read. */
  me: MeSession | null,
): StaffSessionDecision {
  if (hasStaffPinSession) return { kind: 'allow' };
  // `claimed` and nothing else. A guest session belongs to a spectator who
  // confirmed themselves on a roster; it is not a staff credential.
  if (me?.type === 'claimed') return { kind: 'allow' };
  return { kind: 'sign_in' };
}
