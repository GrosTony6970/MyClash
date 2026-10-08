import { describe, expect, it } from 'vitest';
import type { MeSession } from '@myclash/api-client';

import { resolvePublicPersonal } from './public-personal-decision';

const claimed = (over: Partial<MeSession> = {}): MeSession => ({ type: 'claimed', ...over });
const org = (slug: string) => ({ id: `id-${slug}`, slug, name: slug, role: 'owner' });

describe('resolvePublicPersonal', () => {
  it.each(['guest', 'anonymous'] as const)('sends a %s session to sign in', (type) => {
    expect(resolvePublicPersonal({ type })).toEqual({ kind: 'sign_in', guest: null });
  });

  it('sends a missing payload to sign in', () => {
    expect(resolvePublicPersonal(null)).toEqual({ kind: 'sign_in', guest: null });
  });

  describe('a guest is still sent to sign in, and is named (ruling 268)', () => {
    const lea = {
      id: 'p',
      given_name: 'Léa',
      family_name: 'Martin',
      event_id: 'e',
      claim_status: 'unclaimed',
    };

    it('names her, with the way to her schedule at her Event', () => {
      const me: MeSession = { type: 'guest', person: { ...lea, event_slug: 'fal 2027' } };
      expect(resolvePublicPersonal(me)).toEqual({
        kind: 'sign_in',
        guest: { name: 'Léa Martin', scheduleHref: '/e/fal%202027/my-schedule' },
      });
    });

    it('names nobody when the answer has no Event address: there is no page to open', () => {
      expect(resolvePublicPersonal({ type: 'guest', person: lea })).toEqual({
        kind: 'sign_in',
        guest: null,
      });
    });

    it('names nobody for an anonymous answer that carries a person', () => {
      const me: MeSession = { type: 'anonymous', person: { ...lea, event_slug: 'fal-2027' } };
      expect(resolvePublicPersonal(me)).toEqual({ kind: 'sign_in', guest: null });
    });
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
          user: { id: 'u', email: 'a@b.c', display_name: 'Chosen', profile_name: 'Ros Tell' },
        }),
      );
      expect(d).toMatchObject({ kind: 'allow', displayName: 'Chosen' });
    });

    it('falls back to the name of her profile when the account has none (ruling 298)', () => {
      const d = resolvePublicPersonal(
        claimed({ user: { id: 'u', email: 'a@b.c', profile_name: 'Ros Tell' } }),
      );
      expect(d).toMatchObject({ displayName: 'Ros Tell' });
    });

    it('never names an account by a roster row: it may be on many rosters', () => {
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
      expect(d).toMatchObject({ displayName: 'a@b.c' });
    });

    it('falls back to the email when there is no name at all', () => {
      const d = resolvePublicPersonal(claimed({ user: { id: 'u', email: 'a@b.c' } }));
      expect(d).toMatchObject({ displayName: 'a@b.c' });
    });
  });

  // The footer made its own read of the security status on every personal page: a server
  // error on each one while the auth server gave no answer (ruling 353).
  describe('the footer is drawn from the same read (ruling 353)', () => {
    const user = (has_password?: boolean) => ({ id: 'u', email: 'a@b.c', has_password });

    it('hands the address of the account', () => {
      expect(resolvePublicPersonal(claimed({ user: user() }))).toMatchObject({ email: 'a@b.c' });
    });

    it('hands no address for an account that has none', () => {
      const d = resolvePublicPersonal(claimed({ user: { id: 'u', email: '' } }));
      expect(d).toMatchObject({ email: null, viaGoogle: false });
    });

    it.each([
      ['the auth server said it has no password', false, true],
      ['it has a password', true, false],
      ['the auth server did not say', undefined, false],
    ])('tags the account "via Google" only when it is known: %s', (_w, hasPassword, tagged) => {
      const d = resolvePublicPersonal(claimed({ user: user(hasPassword) }));
      expect(d).toMatchObject({ viaGoogle: tagged });
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
