import { describe, expect, it } from 'vitest';
import { resolveLeagueWorkspaceDecision } from './league-workspace-decision';

describe('resolveLeagueWorkspaceDecision', () => {
  it('allows an account holding a personal league grant', () => {
    const decision = resolveLeagueWorkspaceDecision({
      type: 'claimed',
      admin: { hasLeagueRoles: true, organizations: [] },
    });
    expect(decision).toEqual({ kind: 'allow' });
  });

  it('allows super-admins, who manage every league', () => {
    const decision = resolveLeagueWorkspaceDecision({
      type: 'claimed',
      admin: { isSuperAdmin: true, organizations: [] },
    });
    expect(decision).toEqual({ kind: 'allow' });
  });

  it.each(['owner', 'admin'])(
    'allows an org %s, whose list would be non-empty even without a personal grant',
    (role) => {
      const decision = resolveLeagueWorkspaceDecision({
        type: 'claimed',
        admin: { organizations: [{ slug: 'lyon-amhe', role }] },
      });
      expect(decision).toEqual({ kind: 'allow' });
    },
  );

  it.each(['read_only', 'scorekeeper', 'referee'])(
    'sends an org %s back to their org rather than /login',
    (role) => {
      const decision = resolveLeagueWorkspaceDecision({
        type: 'claimed',
        admin: { organizations: [{ slug: 'lyon-amhe', role }] },
      });
      expect(decision).toEqual({ kind: 'no_access', redirectTo: '/org/lyon-amhe' });
    },
  );

  it('sends a claimed user with no orgs and no grants to the dashboard', () => {
    const decision = resolveLeagueWorkspaceDecision({
      type: 'claimed',
      admin: { organizations: [] },
    });
    expect(decision).toEqual({ kind: 'no_access', redirectTo: '/dashboard' });
  });

  it('treats a missing payload as unauthenticated', () => {
    expect(resolveLeagueWorkspaceDecision(null)).toEqual({ kind: 'unauthenticated' });
  });

  it('treats a guest session as unauthenticated', () => {
    expect(resolveLeagueWorkspaceDecision({ type: 'guest' })).toEqual({ kind: 'unauthenticated' });
  });
});
