import { describe, expect, it, vi } from 'vitest';
import {
  filtersFor,
  mockSupabase as seededSupabase,
  selectsFor,
  writesTo,
  type TableSeed,
} from '../../common/testing/supabase-chain';
import { OnboardingService } from './onboarding.service';
import { clubPage } from './signup-club';

/**
 * No second club at the sign-up (operator ruling 369).
 *
 * Paul owns the club `lyon-escrime`. He fills the organizer sign-up form again with the same
 * address, by email link or by Google. The door made a second club at once, active, under his
 * account. It makes none now: he is signed in and sent into the club he owns, and its page
 * says so. A plain member of somebody's club, and an account with no club, still get theirs.
 */
const PAUL = 'user-paul';
const FREE_SLUG = { data: null, error: null };
const CLUB_MADE = { data: { id: 'org-new' }, error: null };

const owns = (userId: string, slug: string, since: string, role = 'owner') => ({
  user_id: userId,
  role,
  created_at: since,
  organizations: { slug },
});

function build(members: TableSeed) {
  const db = seededSupabase({
    organization_members: members,
    organizations: [FREE_SLUG, CLUB_MADE],
  });
  const service = new OnboardingService(
    { service: db.service } as never,
    { sendMagicLink: vi.fn() } as never,
    { get: vi.fn(), getOrThrow: vi.fn() } as never,
    {} as never,
  );
  const signUp = () => service.completeSignupAfterMagicLink(PAUL, 'Lyon Sabre', 'lyon-sabre');
  return { signUp, db };
}

describe('the sign-up of an account that owns a club (ruling 369)', () => {
  it('makes no second club, and hands back the one he owns', async () => {
    const { signUp, db } = build({
      rows: [
        owns('user-bob', 'bobs-club', '2026-01-01T00:00:00Z'),
        owns(PAUL, 'lyon-escrime', '2026-03-01T00:00:00Z'),
      ],
    });

    await expect(signUp()).resolves.toEqual({ slug: 'lyon-escrime', made: false });

    expect(writesTo(db, 'organizations')).toEqual([]);
    expect(writesTo(db, 'organization_members')).toEqual([]);
    expect(selectsFor(db.from, 'organization_members')).toEqual(['organizations(slug)']);
    expect(filtersFor(db.from, 'organization_members', 'eq')).toEqual([
      ['user_id', PAUL],
      ['role', 'owner'],
    ]);
  });

  it('hands back the club he has owned longest when he owns several', async () => {
    const { signUp, db } = build({
      rows: [
        owns(PAUL, 'lyon-sabre-b', '2026-05-01T00:00:00Z'),
        owns(PAUL, 'lyon-escrime', '2026-03-01T00:00:00Z'),
      ],
    });

    await expect(signUp()).resolves.toEqual({ slug: 'lyon-escrime', made: false });
    expect(filtersFor(db.from, 'organization_members', 'order')).toEqual([
      ['created_at', { ascending: true }],
    ]);
  });

  it('still makes the club of a plain member of somebody else’s club', async () => {
    const { signUp, db } = build({
      rows: [owns(PAUL, 'bobs-club', '2026-01-01T00:00:00Z', 'admin')],
    });

    await expect(signUp()).resolves.toEqual({ slug: 'lyon-sabre', made: true });
    expect(writesTo(db, 'organizations').map((write) => write.row)).toEqual([
      expect.objectContaining({ slug: 'lyon-sabre', created_by_user_id: PAUL }),
    ]);
    expect(writesTo(db, 'organization_members').map((write) => write.row)).toEqual([
      { organization_id: 'org-new', user_id: PAUL, role: 'owner' },
    ]);
  });

  // Ruling 363's way out: an account whose club could not be written signs up again.
  it('still makes the club of an account that owns none', async () => {
    const { signUp } = build({ rows: [owns('user-bob', 'bobs-club', '2026-01-01T00:00:00Z')] });

    await expect(signUp()).resolves.toEqual({ slug: 'lyon-sabre', made: true });
  });

  // The read decides whether a club is made: "no answer" is not "he owns none".
  it('fails the sign-up, and makes no club, when his clubs cannot be read', async () => {
    const { signUp, db } = build({ data: null, error: { message: 'statement timeout' } });

    await expect(signUp()).rejects.toThrow(
      'The clubs account user-paul owns could not be read: statement timeout',
    );
    expect(writesTo(db, 'organizations')).toEqual([]);
  });
});

describe('the page a sign-up sends its account to (ruling 369)', () => {
  it('is the club that was made', () => {
    expect(clubPage({ slug: 'lyon-sabre', made: true })).toBe('/org/lyon-sabre');
  });

  it('is the club he owned, with the reason no second one was made', () => {
    expect(clubPage({ slug: 'lyon-escrime', made: false })).toBe(
      '/org/lyon-escrime?refused=already_owns_club',
    );
  });
});
