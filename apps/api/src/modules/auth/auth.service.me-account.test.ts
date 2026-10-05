import { Logger } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LegalAcceptanceService } from '../privacy/legal-acceptance.service';
import { AuthService } from './auth.service';
import {
  filtersFor,
  mockSupabase as seededSupabase,
  queriedTables,
  selectsFor,
  type TableSeed,
} from '../../common/testing/supabase-chain';

/**
 * What `/me` answers a signed-in account (operator rulings 295 and 298).
 *
 * 298. Paul has an account and is on the roster of two Events. `/me` read "his roster row"
 * with a read that takes one row only: with two rows it failed, the failure was dropped, and
 * the site header showed his email where a Fighter of one Event read his name. `/me` now hands
 * the name of his profile, the row it already reads for his photo, and reads no roster row.
 *
 * 295. Marie is an organiser. She opens the admin site during a short database fault: the
 * login check works, the read of her clubs fails. `/me` answered "signed in, no club, no
 * platform role", and the admin site sent her to the sign-in page. A read that DECIDES what
 * she may open now fails `/me`; the admin shells keep her page on an unreadable `/me`. A read that
 * only decorates the header (her photo, her name) degrades and leaves a warning.
 */
const PAUL = { id: 'user-paul', email: 'paul@example.com', user_metadata: {} };
const OTHER = 'user-other';
const FAULT = { data: null, error: { message: 'statement timeout' } };

/** Every table the account branch reads, each with a row of ANOTHER account as a decoy. */
const TABLES: Record<string, TableSeed> = {
  platform_roles: { rows: [{ user_id: OTHER, role: 'super_admin' }] },
  organization_members: {
    rows: [
      {
        user_id: OTHER,
        role: 'owner',
        organizations: { id: 'org-other', slug: 'other', name: 'Other club' },
      },
    ],
  },
  league_user_roles: { rows: [{ user_id: OTHER, role: 'admin' }] },
  global_persons: {
    rows: [
      {
        id: 'profile-other',
        claimed_by_user_id: OTHER,
        photo_url: 'https://cdn.example/not-me.jpg',
        display_name: 'Someone Else',
      },
    ],
  },
};

const PAUL_PROFILE = {
  id: 'profile-paul',
  claimed_by_user_id: PAUL.id,
  photo_url: 'https://cdn.example/paul.jpg',
  display_name: 'Paul Martin',
};

const config = {
  getOrThrow: vi.fn(),
  get: vi.fn((key: string, def?: string) => (key === 'DOMAIN' ? 'myclash.localhost' : (def ?? ''))),
};

const request = {
  headers: { authorization: 'Bearer paul-token' },
  cookies: {},
} as never;

function build(over: Record<string, TableSeed> = {}) {
  const db = seededSupabase({ ...TABLES, ...over });
  const supabase = {
    getAuthUser: vi.fn().mockResolvedValue(PAUL),
    refreshSession: vi.fn(),
    service: db.service,
  };
  const service = new AuthService(
    supabase as never,
    { sendMagicLink: vi.fn() } as never,
    config as never,
    {} as never,
    { pendingFor: vi.fn().mockResolvedValue([]) } as unknown as LegalAcceptanceService,
    {} as never,
  );
  return { service, db };
}

let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the name `/me` hands an account (ruling 298)', () => {
  it('is the name of the account’s own profile, read with its photo', async () => {
    const { service, db } = build({
      global_persons: {
        rows: [...(TABLES.global_persons as { rows: never[] }).rows, PAUL_PROFILE],
      },
    });

    const me = await service.getMe(request);

    expect(me.user).toEqual({
      id: PAUL.id,
      email: PAUL.email,
      display_name: undefined,
      photo_url: 'https://cdn.example/paul.jpg',
      profile_name: 'Paul Martin',
    });
    expect(selectsFor(db.from, 'global_persons')).toEqual(['photo_url, display_name']);
    expect(filtersFor(db.from, 'global_persons', 'eq')).toEqual([['claimed_by_user_id', PAUL.id]]);
  });

  it('reads no roster row: an account on two Events has two, and no one of them is "his"', async () => {
    // `persons` is not seeded: the double throws on a table it was not given.
    const { service, db } = build();

    const me = await service.getMe(request);

    expect(queriedTables(db.from)).not.toContain('persons');
    expect(me.person).toBeUndefined();
  });

  it('hands no name and no photo to an account with no profile', async () => {
    const { service } = build();

    const me = await service.getMe(request);

    expect(me.type).toBe('claimed');
    expect(me.user?.profile_name).toBeUndefined();
    expect(me.user?.photo_url).toBeUndefined();
    expect(warn).not.toHaveBeenCalled();
  });

  it('keeps her signed in when her profile cannot be read, and leaves a warning', async () => {
    const { service } = build({ global_persons: FAULT });

    const me = await service.getMe(request);

    expect(me.type).toBe('claimed');
    expect(me.user?.profile_name).toBeUndefined();
    expect(me.user?.photo_url).toBeUndefined();
    expect(warn).toHaveBeenCalledWith(
      `/me: the profile of ${PAUL.id} is unreadable (statement timeout); no name, no photo`,
    );
  });
});

describe('a claim the database refuses (ruling 296)', () => {
  it('leaves the database’s own reason in the log, not a guess about a missing table', async () => {
    const refusal =
      'duplicate key value violates unique constraint "persons_event_id_claimed_by_user_id_key"';
    const { service } = build({
      persons: [
        { data: { id: 'row-b', email: PAUL.email, claimed_by_user_id: null }, error: null },
        { data: null, error: { message: refusal } },
      ],
    });

    await service.claimPersons(request, ['row-b']);

    expect(warn).toHaveBeenCalledWith(`Could not claim person row-b for ${PAUL.id}: ${refusal}`);
  });
});

describe('a read of `/me` that decides what she may open (ruling 295)', () => {
  it.each([
    ['her platform role', 'platform_roles', `Platform role of ${PAUL.id} unreadable`],
    ['her clubs', 'organization_members', `Clubs of ${PAUL.id} unreadable`],
    ['her League grant', 'league_user_roles', `League grant of ${PAUL.id} unreadable`],
  ])('fails `/me` when %s cannot be read: it is not "none"', async (_what, table, words) => {
    const { service } = build({ [table]: FAULT });

    const failure = await service.getMe(request).then(
      () => null,
      (err: unknown) => err,
    );

    // A plain Error is a 5xx with a trace; an HttpException would be an answer about her.
    expect(failure).toBeInstanceOf(Error);
    expect(Object.getPrototypeOf(failure)).toBe(Error.prototype);
    expect((failure as Error).message).toBe(`${words}: statement timeout`);
  });

  it('answers her clubs, her role and her grant when every read lands', async () => {
    // Beside the other account's rows: a read that lost its scope would hand them too.
    const beside = (table: string, row: Record<string, unknown>) => ({
      rows: [...(TABLES[table] as { rows: Record<string, unknown>[] }).rows, row],
    });
    const { service } = build({
      platform_roles: beside('platform_roles', { user_id: PAUL.id, role: 'platform_admin' }),
      organization_members: beside('organization_members', {
        user_id: PAUL.id,
        role: 'owner',
        organizations: { id: 'org-1', slug: 'salle-1', name: 'Salle 1' },
      }),
      league_user_roles: beside('league_user_roles', { user_id: PAUL.id, role: 'owner' }),
    });

    const me = await service.getMe(request);

    expect(me.admin).toEqual({
      platformRole: 'platform_admin',
      organizations: [{ id: 'org-1', slug: 'salle-1', name: 'Salle 1', role: 'owner' }],
      hasLeagueRoles: true,
    });
  });
});
