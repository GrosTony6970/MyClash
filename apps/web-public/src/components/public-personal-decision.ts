import type { MeSession } from '@myclash/api-client';

/**
 * What the personal-space shell (`/me/*`) should do with a `/me` read, and the
 * three derived values it renders from one.
 *
 * The derivation is here rather than in the component because it has real rules
 * — a display name falls through three sources, and "has an admin workspace" is
 * a union of three grants — and `web-public` cannot assert anything that only
 * exists inside a React tree.
 */
export type PublicPersonalDecision =
  | {
      kind: 'allow';
      displayName: string | null;
      photoUrl: string | null;
      /**
       * True when this competitor account ALSO holds a super-admin, organiser or
       * league grant. Drives the "switch to admin workspace" escape hatch for the
       * user who signs in on the public app but manages tournaments on admin.
       */
      hasAdminAccess: boolean;
    }
  | { kind: 'sign_in' }
  /**
   * The API could not be asked. NOT a signed-out session — `/me` is `@Public()`
   * and answers `anonymous` with a 200, so a failed read is an outage, a 429 or
   * bad wifi. This shell used to send every one of those to /login, signing out
   * a competitor mid-event over a dropped connection. Matches the ruling the
   * admin shells took in 00d19114: the visitor keeps their session and their
   * page, because the cookie is still theirs and every other call still carries
   * it.
   */
  | { kind: 'unverified' };

export function resolvePublicPersonal(
  me: MeSession | null,
  /** False when the read failed for any reason other than being signed out. */
  reachable = true,
): PublicPersonalDecision {
  if (!reachable) return { kind: 'unverified' };
  if (!me || me.type !== 'claimed') return { kind: 'sign_in' };

  const personName = [me.person?.given_name, me.person?.family_name]
    .filter(Boolean)
    .join(' ')
    .trim();

  return {
    kind: 'allow',
    displayName: me.user?.display_name || personName || me.user?.email || null,
    photoUrl: me.user?.photo_url ?? null,
    hasAdminAccess: Boolean(
      me.admin &&
      (me.admin.platformRole || me.admin.organizations.length > 0 || me.admin.hasLeagueRoles),
    ),
  };
}
