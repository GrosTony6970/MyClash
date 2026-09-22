import { Logger } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mockSupabase, writesTo } from '../../common/testing/supabase-chain';
import { GlobalPersonResolverService } from './global-person-resolver.service';

/**
 * What an Event's roster may do to the global profiles it matches: link, never
 * write (operator ruling 35), and find a profile by a HEMA Ratings id typed only
 * on roster rows (ruling 43). The older tier-by-tier tests sit beside this file.
 */

const NAME = { givenName: 'Jean', familyName: 'Dupont' };

/**
 * A match links; it never writes (operator ruling 35, 2026-09-22). It used to
 * fill an existing profile's EMPTY email and date of birth from the roster, so an
 * organiser could put their own address on a stranger's unclaimed profile — the
 * claim link is mailed to that address, and signing in with it claims the
 * profile. Only the fighter or a super admin changes a profile's details, as
 * RLS `global_persons_update` says.
 */
describe('a match writes nothing onto the profile it links to', () => {
  // Anna's unclaimed profile, with no email and no date of birth on file — a
  // shape the fill touched. Every case brings both, so a fill of either one at
  // any tier writes.
  const ANNA = { data: [{ id: 'gp-anna', email: null, date_of_birth: null }], error: null };
  const NOBODY = { data: [], error: null };
  const CLUB = { clubId: 'club-1', hemaRatingsId: null };
  const NO_TIER = { clubId: null, hemaRatingsId: null };

  it.each([
    // Canned: the one tier the identifiers allow asks, and finds Anna.
    ['Tier 1, the HEMA Ratings id', { clubId: null, hemaRatingsId: '1234' }, ANNA],
    ['Tier 2, name + club + date of birth', CLUB, ANNA],
    // A queue: Tier 2 finds nobody, then Tier 3 finds Anna.
    ['Tier 3, name + club', CLUB, [NOBODY, ANNA]],
    // No tier can ask, so the email link does, and finds Anna by that email. It
    // never filled anything; this row keeps a fill from being added there.
    ['the email link', NO_TIER, { data: { id: 'gp-anna', date_of_birth: null }, error: null }],
  ])('%s', async (_tier, identifiers, seed) => {
    const db = mockSupabase({ global_persons: seed });

    const res = await new GlobalPersonResolverService(db as never).resolveOrCreateGlobalPerson({
      ...NAME,
      ...identifiers,
      dateOfBirth: '1990-01-01',
      email: 'mallory@example.com',
      genderCategory: null,
    });

    expect(res).toEqual({ id: 'gp-anna', created: false, mintReason: null });
    expect(writesTo(db, 'global_persons')).toEqual([]);
  });

  it('a profile it mints still takes the email, date of birth and HEMA Ratings id given', async () => {
    const db = mockSupabase({
      // Tier 1 finds nobody, the email link finds nobody, then the insert.
      global_persons: [
        NOBODY,
        { data: null, error: null },
        { data: { id: 'gp-new' }, error: null },
      ],
      // No roster row carries the id either.
      persons: NOBODY,
    });

    const res = await new GlobalPersonResolverService(db as never).resolveOrCreateGlobalPerson({
      ...NAME,
      clubId: null,
      hemaRatingsId: '1234',
      dateOfBirth: '1990-01-01',
      email: 'Anna@Example.com',
      genderCategory: null,
    });

    expect(res).toEqual({ id: 'gp-new', created: true, mintReason: 'first_sighting' });
    const [minted] = writesTo(db, 'global_persons');
    expect(minted?.op).toBe('insert');
    expect(minted?.row).toMatchObject({
      email: 'anna@example.com',
      date_of_birth: '1990-01-01',
      hema_ratings_id: '1234',
    });
  });
});

/**
 * The roster rows, as the last resort before minting (operator rulings 43 and
 * 44, 2026-09-22): when no profile holds the typed HEMA Ratings id and no other
 * tier matched, the one live profile every roster row with that id is linked
 * to — if that profile holds no HEMA Ratings id of its own. Since ruling 35 the
 * typed id stays on the roster row.
 */
describe('the roster rows, as the last resort', () => {
  const live = (id: string, over: Record<string, unknown> = {}) => ({
    id,
    hema_ratings_id: null,
    merged_into_id: null,
    deleted_at: null,
    account_deleted_at: null,
    ...over,
  });
  const typed = (profileId: string | null, hemaRatingsId = '1234') => ({
    hema_ratings_id: hemaRatingsId,
    global_person_id: profileId,
  });
  // A roster row still being linked, and one with another id pointing elsewhere.
  const DECOY_ROWS = [typed(null), typed('gp-other', '9999')];

  const resolve = (tables: Record<string, unknown>, email: string | null = null) => {
    const db = mockSupabase(tables as never);
    return {
      db,
      result: new GlobalPersonResolverService(db as never).resolveOrCreateGlobalPerson({
        ...NAME,
        clubId: null,
        hemaRatingsId: '1234',
        dateOfBirth: null,
        email,
        genderCategory: null,
      }),
    };
  };
  const MINTABLE = { returning: { id: 'gp-new' } };

  // The one tier with an accepted false positive leaves a trace when it fires.
  const logged = () => vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  afterEach(() => vi.restoreAllMocks());

  it('links to the one profile the roster rows with that id point at, and writes nothing', async () => {
    const log = logged();
    const { db, result } = resolve({
      global_persons: { rows: [live('gp-other'), live('gp-anna')], ...MINTABLE },
      persons: { rows: [...DECOY_ROWS, typed('gp-anna'), typed('gp-anna')] },
    });
    await expect(result).resolves.toEqual({ id: 'gp-anna', created: false, mintReason: null });
    expect(writesTo(db, 'global_persons')).toEqual([]);
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/1234.*gp-anna/));
  });

  it('a profile that holds the id wins over the roster rows', async () => {
    const { result } = resolve({
      global_persons: {
        rows: [live('gp-anna'), live('gp-real', { hema_ratings_id: '1234' })],
        ...MINTABLE,
      },
      persons: { rows: [typed('gp-anna')] },
    });
    await expect(result).resolves.toMatchObject({ id: 'gp-real', created: false });
  });

  it('does not ask the roster when two profiles hold the id', async () => {
    const { result } = resolve({
      global_persons: {
        rows: [
          live('gp-anna'),
          live('gp-x', { hema_ratings_id: '1234' }),
          live('gp-y', { hema_ratings_id: '1234' }),
        ],
        ...MINTABLE,
      },
      persons: { rows: [typed('gp-anna')] },
    });
    await expect(result).resolves.toMatchObject({ id: 'gp-new', created: true });
  });

  it('lets an email match win over the roster rows', async () => {
    const { result } = resolve(
      {
        global_persons: {
          rows: [live('gp-anna'), live('gp-bruno', { email: 'bruno@example.com' })],
          ...MINTABLE,
        },
        persons: { rows: [typed('gp-anna')] },
      },
      'bruno@example.com',
    );
    await expect(result).resolves.toMatchObject({ id: 'gp-bruno', created: false });
  });

  // A typo: Bruno's id was typed on Anna's rows, and Anna has since set her own.
  it('never links a profile that holds a HEMA Ratings id of its own', async () => {
    const log = logged();
    const { result } = resolve({
      global_persons: {
        rows: [live('gp-other'), live('gp-anna', { hema_ratings_id: '5678' })],
        ...MINTABLE,
      },
      persons: { rows: [typed('gp-anna')] },
    });
    await expect(result).resolves.toMatchObject({ id: 'gp-new', created: true });
    expect(log).not.toHaveBeenCalled();
  });

  it('links nothing when the roster rows point at two profiles', async () => {
    const { result } = resolve({
      global_persons: { rows: [live('gp-anna'), live('gp-bruno')], ...MINTABLE },
      persons: { rows: [typed('gp-anna'), typed('gp-bruno')] },
    });
    await expect(result).resolves.toMatchObject({ id: 'gp-new', created: true });
  });

  it.each([
    ['a merged', { merged_into_id: 'gp-other' }],
    ['a deleted', { deleted_at: '2026-01-01T00:00:00Z' }],
    // Erasure blanks the profile's id but keeps the roster rows' own.
    ['an erased', { account_deleted_at: '2026-01-01T00:00:00Z' }],
  ])('never links %s profile', async (_state, over) => {
    const { result } = resolve({
      global_persons: { rows: [live('gp-other'), live('gp-anna', over)], ...MINTABLE },
      persons: { rows: [typed('gp-anna')] },
    });
    await expect(result).resolves.toMatchObject({ id: 'gp-new', created: true });
  });
});
