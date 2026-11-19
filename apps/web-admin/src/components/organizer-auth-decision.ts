import type { MeSession } from '@myclash/api-client';

/**
 * Pure auth-gate decision for the OrganizerAdminShell.
 *
 * Extracted from the shell so it can be unit-tested without mounting
 * React, and so the three outcomes are spelled out as a discriminated
 * value instead of a sequence of side-effects. Critically, this
 * function distinguishes "the URL slug doesn't match any of this
 * user's orgs" (a navigation / link bug) from "this session is not
 * authenticated" (a real auth failure). The original auth gate
 * collapsed both into a `/login` redirect, which silently logged the
 * operator out when they happened to land on `/org/undefined/...`.
 *
 * `redirectTo` carries the recovery URL on `no_access` so the shell
 * can `router.replace` the user back to a working org route without
 * dropping their session.
 *
 * Takes `MeSession` — the shape generated from the API's own DTO — rather than
 * a private `OrganizerMePayload`. That local type was one of eleven hand-written
 * copies of this payload, and it widened `platformRole` to `string | null`; the
 * generated one carries the real tier union.
 */
export type OrganizerAuthDecision =
  { kind: 'allow' } | { kind: 'unauthenticated' } | { kind: 'no_access'; redirectTo: string };

export function resolveAuthDecision(slug: string, me: MeSession | null): OrganizerAuthDecision {
  if (!me || me.type !== 'claimed') return { kind: 'unauthenticated' };
  if (me.admin?.platformRole) return { kind: 'allow' };

  const orgs = me.admin?.organizations ?? [];
  if (orgs.some((o) => o.slug === slug)) return { kind: 'allow' };

  // Auto-redirect target on no_access: platform staff go to /admin (the
  // earlier platformRole branch already covered that, kept for
  // completeness); members go to their first known org; if a user
  // somehow has zero orgs, fall back to /login so they see an explicit
  // sign-in flow instead of a blank shell.
  const firstOrg = orgs[0];
  if (firstOrg) return { kind: 'no_access', redirectTo: `/org/${firstOrg.slug}` };
  return { kind: 'no_access', redirectTo: '/login' };
}

/**
 * The reader's role in the club `slug` names, or null when they hold none there: platform staff,
 * let in by their platform role above, whose reach is decided route by route; or a `/me` not read
 * yet. The organiser menu hides what this role cannot open (ruling 893, `applyMemberRole`).
 */
export function memberRoleIn(me: MeSession | null, slug: string): string | null {
  return me?.admin?.organizations.find((o) => o.slug === slug)?.role ?? null;
}
