import { HttpException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { LEGAL_POLICIES } from '@myclash/types';
import {
  mockSupabase as seededSupabase,
  scopedTo,
  writesTo,
  type TableSeed,
} from '../../common/testing/supabase-chain';
import { OnboardingService } from './onboarding.service';

/**
 * A club that cannot be made (operator ruling 299).
 *
 * `createOrgAndMembership` caught every failure and logged "tables may not exist yet", so the
 * sign-up link and the Google sign-up redirected to a club that did not exist. For those two doors
 * (`completeSignupAfterMagicLink`) a failed write now fails the sign-up. The password door made
 * its account a moment before: it removes that account and fails too (operator ruling 306).
 */
const FAULT = { data: null, error: { message: 'connection refused' } };
const FREE_SLUG = { data: null, error: null };
const CLUB_MADE = { data: { id: 'org-1' }, error: null };

const config = {
  get: vi.fn((key: string, def?: string) => (key === 'DOMAIN' ? 'myclash.localhost' : (def ?? ''))),
  getOrThrow: vi.fn(),
};

function build(tables: Record<string, TableSeed>) {
  const db = seededSupabase(tables);
  const createUser = vi.fn().mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null });
  const generateLink = vi
    .fn()
    .mockResolvedValue({ data: { properties: { hashed_token: 'c0de' } }, error: null });
  const deleteAuthAdminUser = vi.fn().mockResolvedValue({ ok: true, status: 200 });
  const supabase = {
    service: { from: db.service.from, auth: { admin: { createUser, generateLink } } },
    deleteAuthAdminUser,
  };
  const legal = {
    assertCurrent: vi.fn((versions: unknown) => versions),
    recordForUser: vi.fn().mockResolvedValue(undefined),
  };
  const mail = { sendMagicLink: vi.fn() };
  const service = new OnboardingService(
    supabase as never,
    mail as never,
    config as never,
    legal as never,
  );
  return { service, db, legal, mail, deleteAuthAdminUser };
}

describe('the club of a sign-up by link or by Google (ruling 299)', () => {
  it('is made with its owner', async () => {
    const { service, db } = build({
      organizations: [FREE_SLUG, CLUB_MADE],
      organization_members: { data: null, error: null },
    });

    await service.completeSignupAfterMagicLink('user-1', 'Lyon AMHE', 'lyon-amhe');

    expect(writesTo(db, 'organizations').map((write) => write.row)).toEqual([
      { name: 'Lyon AMHE', slug: 'lyon-amhe', status: 'active', created_by_user_id: 'user-1' },
    ]);
    expect(writesTo(db, 'organization_members').map((write) => write.row)).toEqual([
      { organization_id: 'org-1', user_id: 'user-1', role: 'owner' },
    ]);
  });

  it('fails the sign-up when the club cannot be written', async () => {
    const { service, db } = build({
      organizations: [FREE_SLUG, FAULT],
      organization_members: { data: null, error: null },
    });

    await expect(
      service.completeSignupAfterMagicLink('user-1', 'Lyon AMHE', 'lyon-amhe'),
    ).rejects.toThrow('Failed to create organization: connection refused');
    expect(writesTo(db, 'organization_members')).toEqual([]);
  });

  it('fails the sign-up when its owner cannot be written', async () => {
    const { service, db } = build({
      organizations: [FREE_SLUG, CLUB_MADE],
      organization_members: FAULT,
    });

    await expect(
      service.completeSignupAfterMagicLink('user-1', 'Lyon AMHE', 'lyon-amhe'),
    ).rejects.toThrow('Failed to create org membership: connection refused');
    // A club with no owner would hold its address for good: her second try would
    // find `lyon-amhe` taken by a club nobody can open.
    const [, removal] = writesTo(db, 'organizations');
    expect(removal?.op).toBe('delete');
    expect(scopedTo(removal, 'id')).toBe('org-1');
  });

  it('hands back the address of the club it made', async () => {
    const { service } = build({
      organizations: [FREE_SLUG, CLUB_MADE],
      organization_members: { data: null, error: null },
    });

    await expect(
      service.completeSignupAfterMagicLink('user-1', 'Lyon AMHE', 'lyon-amhe'),
    ).resolves.toBe('lyon-amhe');
  });

  // Ruling 304: somebody took her address between her request and her click.
  it('makes the club under another address when hers was taken, and hands that one back', async () => {
    const { service, db } = build({
      organizations: [{ data: { id: 'org-bob' }, error: null }, CLUB_MADE],
      organization_members: { data: null, error: null },
    });

    const made = await service.completeSignupAfterMagicLink('user-1', 'Lyon AMHE', 'lyon-amhe');

    expect(made).toMatch(/^lyon-amhe-[a-z0-9]+$/u);
    expect(writesTo(db, 'organizations').map((write) => write.row)).toEqual([
      expect.objectContaining({ slug: made, created_by_user_id: 'user-1' }),
    ]);
  });
});

/**
 * Ann signs up with a password. Her account is made, then her club cannot be written. She read
 * "Account created", clicked her mail and landed on a club page that did not exist. No screen
 * lets an account with no club make one, and a second sign-up was refused as "already
 * registered". The account is now removed and the sign-up fails, so her second try starts clean.
 */
describe('a sign-up by password that cannot be finished (ruling 306)', () => {
  const ANN = {
    email: 'ann@example.com',
    displayName: 'Ann',
    method: 'password' as const,
    password: 'Securepassword123!',
    orgName: 'Lyon AMHE',
    orgSlug: 'lyon-amhe',
    acceptedTerms: LEGAL_POLICIES.terms.version,
    acceptedPrivacy: LEGAL_POLICIES.privacy.version,
  };
  const CLUB_FAILS = {
    organizations: [FREE_SLUG, FAULT],
    organization_members: { data: null, error: null },
  };

  it('removes the account, fails as a server error and sends no mail when the club fails', async () => {
    const { service, mail, deleteAuthAdminUser } = build(CLUB_FAILS);

    const failure = await service.signup(ANN).catch((thrown: unknown) => thrown);

    expect(failure).toBeInstanceOf(Error);
    expect(failure).not.toBeInstanceOf(HttpException);
    expect((failure as Error).message).toBe('Failed to create organization: connection refused');
    expect(deleteAuthAdminUser.mock.calls).toEqual([['user-1']]);
    expect(mail.sendMagicLink).not.toHaveBeenCalled();
  });

  // Only a THROWN fault reaches this: `LegalAcceptanceService` logs a row the
  // database refuses and goes on, by its own older rule (`/me` asks her again).
  it('removes the account when the record of what she accepted throws, and makes no club', async () => {
    const { service, db, legal, deleteAuthAdminUser } = build(CLUB_FAILS);
    legal.recordForUser.mockRejectedValue(new Error('legal_acceptances unwritable'));

    await expect(service.signup(ANN)).rejects.toThrow('legal_acceptances unwritable');

    expect(deleteAuthAdminUser.mock.calls).toEqual([['user-1']]);
    expect(writesTo(db, 'organizations')).toEqual([]);
  });

  it("still fails with the club's fault when the account cannot be removed", async () => {
    const { service, deleteAuthAdminUser } = build(CLUB_FAILS);
    deleteAuthAdminUser.mockResolvedValue({ ok: false, status: 500 });

    await expect(service.signup(ANN)).rejects.toThrow('Failed to create organization');
  });

  it('keeps the account and mails her when the club is made', async () => {
    const { service, mail, deleteAuthAdminUser } = build({
      organizations: [FREE_SLUG, CLUB_MADE],
      organization_members: { data: null, error: null },
    });

    await expect(service.signup(ANN)).resolves.toMatchObject({ type: 'password' });

    expect(deleteAuthAdminUser).not.toHaveBeenCalled();
    expect(mail.sendMagicLink).toHaveBeenCalledOnce();
  });
});
