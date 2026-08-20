import type { MeSession } from '@myclash/api-client';

/**
 * Where a freshly-authenticated admin session should land, from `/me`.
 *
 * Extracted from `app/dashboard/page.tsx`, where it was a `resolveLanding()`
 * that did its own fetch — so the routing rules below, which are the subtle
 * part, could not be asserted without a browser. The fetch stays in the page;
 * this is the decision.
 *
 * Dual-role exception: a user who holds BOTH a platform role AND a membership
 * of at least one organization gets a `chooser` (not an automatic /admin
 * redirect). Forcing /admin used to strand the "sole operator" — an organiser
 * who also works the platform — on the console with no path to their
 * tournaments. Platform-only accounts still go straight to /admin.
 *
 * Applies to every tier, not just super-admin: a platform admin who also runs
 * their own club has exactly the same problem.
 */
export type AdminLanding =
  | { kind: 'redirect'; href: string }
  | { kind: 'chooser'; organizerSlug: string }
  | { kind: 'noWorkspace' };

export function resolveAdminLanding(me: MeSession | null): AdminLanding {
  // Includes the unreachable case, which the page passes as null. /login is the
  // honest answer: this page has nothing of its own to show and no way to work
  // out where else to send them.
  if (!me || me.type !== 'claimed') return { kind: 'redirect', href: '/login' };

  const organizations = me.admin?.organizations ?? [];
  const firstOrg = organizations.find((organization) => Boolean(organization.slug));

  if (me.admin?.platformRole) {
    return firstOrg
      ? { kind: 'chooser', organizerSlug: firstOrg.slug }
      : { kind: 'redirect', href: '/admin' };
  }

  if (firstOrg) return { kind: 'redirect', href: `/org/${firstOrg.slug}` };

  // Checked AFTER the org branch: an org owner who also holds a personal league
  // grant keeps landing on the org workspace they use daily, and reaches
  // /leagues through the sidebar instead. This branch is for the account whose
  // only grant is a league — previously a dead end here.
  if (me.admin?.hasLeagueRoles) return { kind: 'redirect', href: '/leagues' };

  return { kind: 'noWorkspace' };
}
