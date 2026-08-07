import { describe, expect, it } from 'vitest';
import { resolveAuthDecision } from './organizer-auth-decision';

describe('resolveAuthDecision', () => {
  it("allows when the URL slug matches one of the user's orgs", () => {
    const decision = resolveAuthDecision('test-org', {
      type: 'claimed',
      admin: { organizations: [{ slug: 'test-org' }] },
    });
    expect(decision).toEqual({ kind: 'allow' });
  });

  it('allows super-admins regardless of the URL slug', () => {
    const decision = resolveAuthDecision('any-org-they-don-not-own', {
      type: 'claimed',
      admin: { platformRole: 'super_admin', organizations: [] },
    });
    expect(decision).toEqual({ kind: 'allow' });
  });

  // Every platform tier gets in, including read-only: entering the workspace
  // is a read, and the API refuses their writes on its own.
  it.each(['platform_admin', 'platform_viewer'])('allows a %s into any org', (role) => {
    expect(
      resolveAuthDecision('some-other-org', {
        type: 'claimed',
        admin: { platformRole: role, organizations: [] },
      }),
    ).toEqual({ kind: 'allow' });
  });

  it('does NOT treat a null platform role as access', () => {
    const decision = resolveAuthDecision('some-other-org', {
      type: 'claimed',
      admin: { platformRole: null, organizations: [{ slug: 'their-own-org' }] },
    });
    expect(decision.kind).toBe('no_access');
  });

  it('returns no_access (NOT unauthenticated) when the URL slug is the literal "undefined"', () => {
    // The original silent-logout: a stale <Link href> interpolated
    // `undefined` into the slug segment, the auth gate read the URL as
    // a "real" but inaccessible org, and bounced the (authenticated)
    // user to /login. The fix returns no_access + a recovery target
    // pointing at the user's first real org.
    const decision = resolveAuthDecision('undefined', {
      type: 'claimed',
      admin: { organizations: [{ slug: 'test-org' }] },
    });
    expect(decision).toEqual({ kind: 'no_access', redirectTo: '/org/test-org' });
  });

  it('returns no_access with /login fallback when the user has zero orgs', () => {
    const decision = resolveAuthDecision('undefined', {
      type: 'claimed',
      admin: { organizations: [] },
    });
    expect(decision).toEqual({ kind: 'no_access', redirectTo: '/login' });
  });

  it('returns unauthenticated when the me payload is null', () => {
    expect(resolveAuthDecision('test-org', null)).toEqual({ kind: 'unauthenticated' });
  });

  it('returns unauthenticated when type is not "claimed"', () => {
    expect(
      resolveAuthDecision('test-org', {
        type: 'guest_active',
        admin: { organizations: [{ slug: 'test-org' }] },
      }),
    ).toEqual({ kind: 'unauthenticated' });
  });
});
