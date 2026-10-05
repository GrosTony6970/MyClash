import { describe, expect, it, vi } from 'vitest';
import { LEGAL_POLICIES } from '@myclash/types';
import {
  mockSupabase as seededSupabase,
  writesTo,
  type TableSeed,
} from '../../common/testing/supabase-chain';
import { OnboardingService } from './onboarding.service';

/**
 * A club that cannot be made (operator ruling 299).
 *
 * `createOrgAndMembership` caught every failure and logged "tables may not exist yet", so the
 * sign-up link and the Google sign-up redirected to a club that did not exist. For those two doors
 * (`completeSignupAfterMagicLink`) a failed write now fails the sign-up. The password door is not
 * ruled: its account exists by then, so it still answers "account created" and leaves a warning.
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
  const generateLink = vi.fn().mockResolvedValue({ data: { properties: {} }, error: null });
  const supabase = {
    service: { from: db.service.from, auth: { admin: { createUser, generateLink } } },
  };
  const legal = {
    assertCurrent: vi.fn((versions: unknown) => versions),
    recordForUser: vi.fn().mockResolvedValue(undefined),
  };
  const service = new OnboardingService(
    supabase as never,
    { sendMagicLink: vi.fn() } as never,
    config as never,
    legal as never,
  );
  return { service, db };
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
    const { service } = build({
      organizations: [FREE_SLUG, CLUB_MADE],
      organization_members: FAULT,
    });

    await expect(
      service.completeSignupAfterMagicLink('user-1', 'Lyon AMHE', 'lyon-amhe'),
    ).rejects.toThrow('Failed to create org membership: connection refused');
  });
});

describe('the club of a sign-up by password (not ruled)', () => {
  it('still answers "account created" when the club cannot be written', async () => {
    const { service } = build({
      organizations: [FREE_SLUG, FAULT],
      organization_members: { data: null, error: null },
    });

    await expect(
      service.signup({
        email: 'jean@example.com',
        displayName: 'Jean',
        method: 'password',
        password: 'Securepassword123!',
        orgName: 'Lyon AMHE',
        orgSlug: 'lyon-amhe',
        acceptedTerms: LEGAL_POLICIES.terms.version,
        acceptedPrivacy: LEGAL_POLICIES.privacy.version,
      }),
    ).resolves.toMatchObject({ type: 'password', orgSlug: 'lyon-amhe' });
  });
});
