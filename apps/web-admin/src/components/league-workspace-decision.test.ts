import { describe, expect, it } from 'vitest';
import type { MeSession } from '@myclash/api-client';
import { resolveLeagueWorkspaceDecision } from './league-workspace-decision';

/** A claimed `/me` body carrying only the admin block these tests exercise. */
function me(admin: MeSession['admin'], type: MeSession['type'] = 'claimed'): MeSession {
  return { type, admin };
}

/** A whole membership row — the API cannot emit a partial one. */
function org(slug: string, role: string) {
  return { id: `id-${slug}`, slug, name: slug, role };
}

describe('resolveLeagueWorkspaceDecision', () => {
  it('allows an account holding a personal league grant', () => {
    const decision = resolveLeagueWorkspaceDecision(
      me({ platformRole: null, hasLeagueRoles: true, organizations: [] }),
    );
    expect(decision).toEqual({ kind: 'allow' });
  });

  it('allows super-admins, who manage every league', () => {
    const decision = resolveLeagueWorkspaceDecision(
      me({ platformRole: 'super_admin', organizations: [] }),
    );
    expect(decision).toEqual({ kind: 'allow' });
  });

  // Matches the API: assertCanManageLeague widened to platform_admin, and a
  // viewer still reaches the workspace because reading it is a read.
  it.each(['platform_admin', 'platform_viewer'] as const)('allows a %s', (role) => {
    expect(resolveLeagueWorkspaceDecision(me({ platformRole: role, organizations: [] }))).toEqual({
      kind: 'allow',
    });
  });

  it.each(['owner', 'admin'])(
    'allows an org %s, whose list would be non-empty even without a personal grant',
    (role) => {
      const decision = resolveLeagueWorkspaceDecision(
        me({ platformRole: null, organizations: [org('lyon-amhe', role)] }),
      );
      expect(decision).toEqual({ kind: 'allow' });
    },
  );

  it.each(['read_only', 'scorekeeper', 'referee'])(
    'sends an org %s back to their org rather than /login',
    (role) => {
      const decision = resolveLeagueWorkspaceDecision(
        me({ platformRole: null, organizations: [org('lyon-amhe', role)] }),
      );
      expect(decision).toEqual({ kind: 'no_access', redirectTo: '/org/lyon-amhe' });
    },
  );

  it('sends a claimed user with no orgs and no grants to the dashboard', () => {
    const decision = resolveLeagueWorkspaceDecision(me({ platformRole: null, organizations: [] }));
    expect(decision).toEqual({ kind: 'no_access', redirectTo: '/dashboard' });
  });

  it('treats a missing payload as unauthenticated', () => {
    expect(resolveLeagueWorkspaceDecision(null)).toEqual({ kind: 'unauthenticated' });
  });

  it.each(['guest', 'anonymous'] as const)('treats a %s session as unauthenticated', (type) => {
    expect(resolveLeagueWorkspaceDecision(me(undefined, type))).toEqual({
      kind: 'unauthenticated',
    });
  });
});
