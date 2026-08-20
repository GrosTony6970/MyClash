import { describe, expect, it } from 'vitest';
import type { MeSession } from '@myclash/api-client';

import { resolveAdminLanding } from './admin-landing-decision';

function me(admin: MeSession['admin'], type: MeSession['type'] = 'claimed'): MeSession {
  return { type, admin };
}
function org(slug: string) {
  return { id: `id-${slug}`, slug, name: slug, role: 'owner' };
}

describe('resolveAdminLanding', () => {
  it.each([null, 'guest', 'anonymous'] as const)('sends %s to /login', (t) => {
    const session = t === null ? null : me({ platformRole: null, organizations: [] }, t);
    expect(resolveAdminLanding(session)).toEqual({ kind: 'redirect', href: '/login' });
  });

  it('sends a platform-only account straight to the console', () => {
    expect(resolveAdminLanding(me({ platformRole: 'super_admin', organizations: [] }))).toEqual({
      kind: 'redirect',
      href: '/admin',
    });
  });

  // The sole-operator bug: forcing /admin stranded an organiser who also works
  // the platform, with no path back to their own tournaments.
  it.each(['super_admin', 'platform_admin', 'platform_viewer'] as const)(
    'offers a %s who also belongs to an org the chooser rather than /admin',
    (platformRole) => {
      expect(resolveAdminLanding(me({ platformRole, organizations: [org('lyon-amhe')] }))).toEqual({
        kind: 'chooser',
        organizerSlug: 'lyon-amhe',
      });
    },
  );

  it('sends an organiser to their org workspace', () => {
    expect(
      resolveAdminLanding(me({ platformRole: null, organizations: [org('lyon-amhe')] })),
    ).toEqual({ kind: 'redirect', href: '/org/lyon-amhe' });
  });

  // Order matters here, and the comment in the module says why: an org owner who
  // ALSO holds a league grant keeps landing on the org they use daily.
  it('prefers the org workspace over /leagues when the account holds both', () => {
    expect(
      resolveAdminLanding(
        me({ platformRole: null, organizations: [org('lyon-amhe')], hasLeagueRoles: true }),
      ),
    ).toEqual({ kind: 'redirect', href: '/org/lyon-amhe' });
  });

  it('sends a league-only account to /leagues, which used to be a dead end', () => {
    expect(
      resolveAdminLanding(me({ platformRole: null, organizations: [], hasLeagueRoles: true })),
    ).toEqual({ kind: 'redirect', href: '/leagues' });
  });

  it('reports no workspace for a claimed account holding nothing', () => {
    expect(resolveAdminLanding(me({ platformRole: null, organizations: [] }))).toEqual({
      kind: 'noWorkspace',
    });
  });
});
