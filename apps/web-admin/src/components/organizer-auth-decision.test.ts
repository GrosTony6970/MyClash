import { describe, expect, it } from 'vitest';
import type { MeSession } from '@myclash/api-client';
import { resolveAuthDecision } from './organizer-auth-decision';

/** A claimed `/me` body carrying only the admin block these tests exercise. */
function me(admin: MeSession['admin'], type: MeSession['type'] = 'claimed'): MeSession {
  return { type, admin };
}

/**
 * A whole membership row. `MeSession` requires all four members because the API
 * cannot emit fewer: normalizeOrganizationMembership (auth.service.ts:94) drops
 * any row missing one. These tests used to pass `{ slug }` alone, which was a
 * payload /me has never produced.
 */
function org(slug: string) {
  return { id: `id-${slug}`, slug, name: slug, role: 'owner' };
}

describe('resolveAuthDecision', () => {
  it("allows when the URL slug matches one of the user's orgs", () => {
    const decision = resolveAuthDecision(
      'test-org',
      me({ platformRole: null, organizations: [org('test-org')] }),
    );
    expect(decision).toEqual({ kind: 'allow' });
  });

  it('allows super-admins regardless of the URL slug', () => {
    const decision = resolveAuthDecision(
      'any-org-they-don-not-own',
      me({ platformRole: 'super_admin', organizations: [] }),
    );
    expect(decision).toEqual({ kind: 'allow' });
  });

  // Every platform tier gets in, including read-only: entering the workspace
  // is a read, and the API refuses their writes on its own.
  it.each(['platform_admin', 'platform_viewer'] as const)('allows a %s into any org', (role) => {
    expect(
      resolveAuthDecision('some-other-org', me({ platformRole: role, organizations: [] })),
    ).toEqual({ kind: 'allow' });
  });

  it('does NOT treat a null platform role as access', () => {
    const decision = resolveAuthDecision(
      'some-other-org',
      me({ platformRole: null, organizations: [org('their-own-org')] }),
    );
    expect(decision.kind).toBe('no_access');
  });

  it('returns no_access (NOT unauthenticated) when the URL slug is the literal "undefined"', () => {
    // The original silent-logout: a stale <Link href> interpolated
    // `undefined` into the slug segment, the auth gate read the URL as
    // a "real" but inaccessible org, and bounced the (authenticated)
    // user to /login. The fix returns no_access + a recovery target
    // pointing at the user's first real org.
    const decision = resolveAuthDecision(
      'undefined',
      me({ platformRole: null, organizations: [org('test-org')] }),
    );
    expect(decision).toEqual({ kind: 'no_access', redirectTo: '/org/test-org' });
  });

  it('returns no_access with /login fallback when the user has zero orgs', () => {
    const decision = resolveAuthDecision(
      'undefined',
      me({ platformRole: null, organizations: [] }),
    );
    expect(decision).toEqual({ kind: 'no_access', redirectTo: '/login' });
  });

  it('returns unauthenticated when the me payload is null', () => {
    expect(resolveAuthDecision('test-org', null)).toEqual({ kind: 'unauthenticated' });
  });

  // Both real non-claimed values, not the invented 'guest_active' this asserted
  // until 2026-08-20. /me emits claimed | guest | anonymous and never has, so the
  // old test proved the branch fired for a string the API cannot send while
  // saying nothing about the two it does.
  it.each(['guest', 'anonymous'] as const)(
    'returns unauthenticated for a %s session, even one holding org memberships',
    (type) => {
      expect(
        resolveAuthDecision(
          'test-org',
          me({ platformRole: null, organizations: [org('test-org')] }, type),
        ),
      ).toEqual({ kind: 'unauthenticated' });
    },
  );
});
