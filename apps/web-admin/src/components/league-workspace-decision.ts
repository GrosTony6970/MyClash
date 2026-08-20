import type { MeSession } from '@myclash/api-client';

/**
 * Pure auth-gate decision for the LeagueWorkspaceShell (/leagues).
 *
 * Shares `MeSession` with resolveAuthDecision rather than describing the payload
 * again — the two now differ only in the question they ask, which is the point.
 * This file used to open by saying it "mirrors" that function, a prose
 * cross-reference standing in for an import, and prose is what let the eleven
 * copies of this payload drift apart in the first place.
 *
 * Extracted from the shell so the
 * outcomes can be unit-tested without mounting React, and so "you are not
 * signed in" stays distinct from "you have nothing to manage here". Collapsing
 * the two into a /login redirect silently signs the operator out, which is the
 * exact bug the organizer decision documents.
 *
 * The gate is deliberately WIDER than the nav entry that leads here. The entry
 * is shown only for a personal league grant (admin.hasLeagueRoles), because org
 * leagues already live at /org/{slug}/leagues. But /leagues itself lists the
 * full manageable union, so anyone whose list would be non-empty — super
 * admins, and admins/owners of an org that manages a league — must be let in
 * rather than bounced off a page that would have shown them something.
 */
export type LeagueWorkspaceDecision =
  { kind: 'allow' } | { kind: 'unauthenticated' } | { kind: 'no_access'; redirectTo: string };

export function resolveLeagueWorkspaceDecision(me: MeSession | null): LeagueWorkspaceDecision {
  if (!me || me.type !== 'claimed') return { kind: 'unauthenticated' };
  if (me.admin?.platformRole) return { kind: 'allow' };
  if (me.admin?.hasLeagueRoles) return { kind: 'allow' };

  const orgs = me.admin?.organizations ?? [];
  // Mirrors listManageable's org branch: only admin/owner inherit league
  // management from their organization.
  if (orgs.some((o) => o.role === 'admin' || o.role === 'owner')) return { kind: 'allow' };

  // Never /login — the session is valid, there is just nothing here for them.
  const firstOrg = orgs[0];
  if (firstOrg) return { kind: 'no_access', redirectTo: `/org/${firstOrg.slug}` };
  return { kind: 'no_access', redirectTo: '/dashboard' };
}
