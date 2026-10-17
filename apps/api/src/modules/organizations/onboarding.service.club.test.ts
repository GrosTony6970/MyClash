import { describe, expect, it, vi } from 'vitest';
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
 * (`completeSignupAfterMagicLink`) a failed write now fails the sign-up.
 */
const FAULT = { data: null, error: { message: 'connection refused' } };
const FREE_SLUG = { data: null, error: null };
const CLUB_MADE = { data: { id: 'org-1' }, error: null };
// What the read of the clubs she owns answers a new account (ruling 369).
const OWNS_NONE = { data: null, error: null };

const config = {
  get: vi.fn((key: string, def?: string) => (key === 'DOMAIN' ? 'myclash.localhost' : (def ?? ''))),
  getOrThrow: vi.fn(),
};

function build(tables: Record<string, TableSeed>) {
  const db = seededSupabase(tables);
  const supabase = { service: { from: db.service.from } };
  const service = new OnboardingService(
    supabase as never,
    {} as never,
    config as never,
    {} as never,
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
    const { service, db } = build({
      organizations: [FREE_SLUG, CLUB_MADE],
      organization_members: [OWNS_NONE, FAULT],
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
    ).resolves.toEqual({ slug: 'lyon-amhe', made: true });
  });

  // Ruling 304: somebody took her address between her request and her click.
  it('makes the club under another address when hers was taken, and hands that one back', async () => {
    const { service, db } = build({
      organizations: [{ data: { id: 'org-bob' }, error: null }, CLUB_MADE],
      organization_members: { data: null, error: null },
    });

    const made = await service.completeSignupAfterMagicLink('user-1', 'Lyon AMHE', 'lyon-amhe');

    expect(made).toEqual({ slug: expect.stringMatching(/^lyon-amhe-[a-z0-9]+$/u), made: true });
    expect(writesTo(db, 'organizations').map((write) => write.row)).toEqual([
      expect.objectContaining({ slug: made.slug, created_by_user_id: 'user-1' }),
    ]);
  });
});
