import { describe, expect, it } from 'vitest';
import type { MeSession } from '@myclash/api-client';

import { resolvePublicPersonal } from './public-personal-decision';

const claimed = (over: Partial<MeSession> = {}): MeSession => ({ type: 'claimed', ...over });
const org = (slug: string) => ({ id: `id-${slug}`, slug, name: slug, role: 'owner' });

describe('resolvePublicPersonal', () => {
  it.each(['guest', 'anonymous'] as const)('sends a %s session to sign in', (type) => {
    expect(resolvePublicPersonal({ type })).toEqual({ kind: 'sign_in' });
  });

  it('sends a missing payload to sign in', () => {
    expect(resolvePublicPersonal(null)).toEqual({ kind: 'sign_in' });
  });

  // The behaviour this module exists to change. An unreachable API is not a
  // signed-out session, and this shell used to treat it as one.
  it('keeps an unverified visitor put rather than signing them out', () => {
    expect(resolvePublicPersonal(null, false)).toEqual({ kind: 'unverified' });
  });

  describe('display name falls through three sources', () => {
    it('prefers the account display name', () => {
      const d = resolvePublicPersonal(
        claimed({
          user: { id: 'u', email: 'a@b.c', display_name: 'Chosen' },
          person: {
            id: 'p',
            given_name: 'Ros',
            family_name: 'Tell',
            event_id: 'e',
            claim_status: 'claimed',
          },
        }),
      );
      expect(d).toMatchObject({ kind: 'allow', displayName: 'Chosen' });
    });

    it('falls back to the roster name when the account has none', () => {
      const d = resolvePublicPersonal(
        claimed({
          user: { id: 'u', email: 'a@b.c' },
          person: {
            id: 'p',
            given_name: 'Ros',
            family_name: 'Tell',
            event_id: 'e',
            claim_status: 'claimed',
          },
        }),
      );
      expect(d).toMatchObject({ displayName: 'Ros Tell' });
    });

    it('falls back to the email when there is no name at all', () => {
      const d = resolvePublicPersonal(claimed({ user: { id: 'u', email: 'a@b.c' } }));
      expect(d).toMatchObject({ displayName: 'a@b.c' });
    });
  });

  describe('the admin escape hatch is a union of three grants', () => {
    it('offers nothing to a plain competitor', () => {
      const d = resolvePublicPersonal(
        claimed({ admin: { platformRole: null, organizations: [] } }),
      );
      expect(d).toMatchObject({ hasAdminAccess: false });
    });

    it.each([
      ['a platform tier', { platformRole: 'super_admin' as const, organizations: [] }],
      ['an org membership', { platformRole: null, organizations: [org('lyon-amhe')] }],
      ['a league grant', { platformRole: null, organizations: [], hasLeagueRoles: true }],
    ])('offers the switch for %s', (_label, admin) => {
      expect(resolvePublicPersonal(claimed({ admin }))).toMatchObject({ hasAdminAccess: true });
    });
  });
});
