import type { ApiResult, MeSession } from '@myclash/api-client';
import { OFFLINE_CODE } from '../offline/failure-kind';

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
  | { kind: 'sign_in' }
  /**
   * `/api/v1/me` ANSWERED, with a server error (operator rulings 295, 295a): a
   * read that decides her access failed. She may be signed in, so the page says
   * it could not check, with a Retry.
   */
  | { kind: 'unverified' }
  /**
   * A read got no answer, and nothing proved a session (operator, 2026-10-13).
   * Nobody can be asked, and sign-in cannot work either: the page opens the
   * piste the tablet last had (`pisteWithNoNetwork`), where the bar counts the
   * hits it still holds. That piste's own read sends to sign-in on a 401.
   */
  | { kind: 'no_network' };

/**
 * Did the server answer this read with a failure? A request that never landed
 * is not one (`neverLanded`). Null is a read that was not asked.
 *
 * "Never landed" has two shapes. With no service worker the request throws
 * (`network`). Under the worker it does NOT: the worker answers a dead network
 * itself, with a 503 that carries `OFFLINE_CODE`. That answer is no word of the
 * server. Read as one, it sent a tablet with no network to "we could not check
 * who is signed in", whose Retry could only fail again. A 503 with any other
 * code, or none, IS the server (or the edge in front of it): ruling 295a.
 */
export const answeredFault = (read: ApiResult<unknown> | null): boolean =>
  read !== null && !read.ok && read.kind === 'http' && read.code !== OFFLINE_CODE;

/**
 * Did this read get no answer at all? The two shapes of "never landed" above:
 * a request that threw, and the worker's own 503. Null is a read that was not
 * asked.
 */
export const neverLanded = (read: ApiResult<unknown> | null): boolean =>
  read !== null &&
  !read.ok &&
  (read.kind === 'network' || (read.kind === 'http' && read.code === OFFLINE_CODE));

export function resolveStaffSession(
  /** `/api/v1/staff-auth/me` answered 2xx — a PIN session on this tablet. */
  hasStaffPinSession: boolean,
  /** The `/api/v1/me` body, or null when it could not be read. */
  me: MeSession | null,
  /** `answeredFault` of the `/api/v1/me` read. */
  meFault = false,
  /**
   * `neverLanded` of either read. The race: the network can come back between
   * the two, so a read that landed is asked first.
   */
  noNetwork = false,
): StaffSessionDecision {
  if (hasStaffPinSession) return { kind: 'allow' };
  if (meFault) return { kind: 'unverified' };
  // `claimed` and nothing else. A guest session belongs to a spectator who
  // confirmed themselves on a roster; it is not a staff credential.
  if (me?.type === 'claimed') return { kind: 'allow' };
  if (noNetwork) return { kind: 'no_network' };
  return { kind: 'sign_in' };
}
