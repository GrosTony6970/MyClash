/**
 * The "find your profile" search (`GET /me/global-person-search`, rulings 171b, 173): a profile
 * known only through entries hidden from the public — a draft Tournament, a draft or a test Event —
 * is not offered, to anyone: the search spans many Events, so it shows public things only
 * (ruling 163), a club member included. A profile with no roster row stays, and so do a referee
 * of the Event (ruling 167) and a profile made outside a roster (rulings 176, 176a: a HEMA Ratings
 * id alone does not count). Hidden profiles do not crowd out the rest.
 */
import 'reflect-metadata';
import { HttpException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  filtersFor,
  mockSupabase,
  queriedTables,
  selectsFor,
  type TableSeed,
} from '../../common/testing/supabase-chain';
import { OrganizationsService } from '../organizations/organizations.service';
import { AuthService } from './auth.service';

const event = (id: string, status: string, kind = 'standard') => ({
  id,
  status,
  organization_id: 'org-a',
  event_kind: kind,
});
const tournament = (id: string, eventId: string, status: string) => ({
  id,
  event_id: eventId,
  status,
});
const profile = (id: string) => ({
  id,
  slug: id,
  display_name: `Martin ${id}`,
  given_name: id,
  family_name: 'Martin',
  country_code: null,
  claimed_by_user_id: null,
  made_outside_roster: false,
});
// One roster row of a profile, and its entries.
const rosterRow = (id: string, eventId: string, profileId: string) => ({
  id,
  event_id: eventId,
  global_person_id: profileId,
});
const entry = (personId: string, tournamentId: string) => ({
  person_id: personId,
  tournament_id: tournamentId,
  status: 'registered',
});

const ROSTER = [
  rosterRow('p-open', 'e-pub', 'a-open'),
  rosterRow('p-draft', 'e-pub', 'b-draft'),
  rosterRow('p-draft-event', 'e-draft', 'c-draft-event'),
  rosterRow('p-test', 'e-test', 'd-test'),
  rosterRow('p-mixed-draft', 'e-draft', 'f-mixed'),
  rosterRow('p-mixed-open', 'e-pub', 'f-mixed'),
  rosterRow('p-referee', 'e-pub', 'g-referee'),
];
const ENTRIES = [
  entry('p-open', 't-open'),
  entry('p-draft', 't-secret'),
  entry('p-draft-event', 't-autumn'),
  entry('p-test', 't-rehearsal'),
  entry('p-mixed-draft', 't-autumn'),
  entry('p-mixed-open', 't-open'),
  entry('p-referee', 't-secret'),
];

type Tables = Record<string, TableSeed>;
function baseTables(): Tables {
  return {
    global_persons: {
      rows: ['a-open', 'b-draft', 'c-draft-event', 'd-test', 'e-none', 'f-mixed', 'g-referee'].map(
        profile,
      ),
    },
    events: {
      rows: [
        event('e-pub', 'published'),
        event('e-draft', 'draft'),
        event('e-test', 'published', 'test'),
      ],
    },
    tournaments: {
      rows: [
        tournament('t-open', 'e-pub', 'published'),
        tournament('t-secret', 'e-pub', 'draft'),
        tournament('t-autumn', 'e-draft', 'published'),
        tournament('t-rehearsal', 'e-test', 'published'),
      ],
    },
    persons: { rows: ROSTER },
    registrations: { rows: ENTRIES },
    event_referees: { rows: [{ event_id: 'e-pub', person_id: 'g-referee' }] },
    event_instructors: { rows: [] },
    // A member of the club: the search still shows her public things only (ruling 163).
    organization_members: { rows: [{ organization_id: 'org-a', user_id: 'u-1', role: 'owner' }] },
    event_staff_accounts: { rows: [] },
  };
}

let db: ReturnType<typeof mockSupabase>;

function search(query = 'Martin') {
  const supabase = { service: db.service, getAuthUser: vi.fn(async () => ({ id: 'u-1' })) };
  const service = new AuthService(
    supabase as never,
    {} as never,
    { getOrThrow: vi.fn(), get: vi.fn((_k: string, def?: string) => def ?? '') } as never,
    {} as never,
    {} as never,
    new OrganizationsService(supabase as never),
  );
  const req = { headers: { authorization: 'Bearer t' }, cookies: {} };
  return service.searchGlobalPersonsForClaim(req as never, query);
}

beforeEach(() => {
  db = mockSupabase(baseTables());
});

describe('the claim search offers no profile known only through hidden entries (ruling 171b)', () => {
  it('leaves out a draft-only, draft-Event-only and test-Event-only profile, even for a club member', async () => {
    expect((await search()).map((row) => row.id)).toEqual([
      'a-open',
      'e-none',
      'f-mixed',
      'g-referee',
    ]);
    // Public things only: nobody's membership is asked.
    expect(queriedTables(db.from)).not.toContain('organization_members');
  });

  it('answers exactly as if the hidden profiles did not exist', async () => {
    const shown = await search();
    const tables = baseTables();
    tables['global_persons'] = {
      rows: ['a-open', 'e-none', 'f-mixed', 'g-referee'].map(profile),
    };
    db = mockSupabase(tables);
    expect(await search()).toEqual(shown);
  });

  it("reads each profile's roster rows", async () => {
    await search();
    // The first read of `persons`; `hiddenEntrantIds` reads it after, for its own ends.
    expect(selectsFor(db.from, 'persons')[0]).toBe('id, event_id, global_person_id');
    expect(filtersFor(db.from, 'persons', 'in')[0]).toEqual([
      'global_person_id',
      ['a-open', 'b-draft', 'c-draft-event', 'd-test', 'e-none', 'f-mixed', 'g-referee'],
    ]);
  });

  it('lets no hidden profile crowd out a visible one', async () => {
    const hidden = Array.from({ length: 25 }, (_, i) => `h${String(i).padStart(2, '0')}`);
    const tables = baseTables();
    tables['global_persons'] = { rows: [...hidden, 'z-open'].map(profile) };
    tables['persons'] = {
      rows: [
        ...hidden.map((id) => rosterRow(`p-${id}`, 'e-pub', id)),
        rosterRow('p-z', 'e-pub', 'z-open'),
      ],
    };
    tables['registrations'] = {
      rows: [...hidden.map((id) => entry(`p-${id}`, 't-secret')), entry('p-z', 't-open')],
    };
    db = mockSupabase(tables);
    expect((await search()).map((row) => row.id)).toEqual(['z-open']);
    // 20 rows, all hidden; then 20 + 20, which reaches the end.
    expect(filtersFor(db.from, 'global_persons', 'limit')).toEqual([[20], [40]]);
  });

  it('keeps 20 when more than 20 are visible, reading once', async () => {
    const many = Array.from({ length: 25 }, (_, i) => `v${String(i).padStart(2, '0')}`);
    db = mockSupabase({ ...baseTables(), global_persons: { rows: many.map(profile) } });
    expect(await search()).toHaveLength(20);
    expect(filtersFor(db.from, 'global_persons', 'limit')).toEqual([[20]]);
  });

  it('keeps a profile whose only roster row has no entry (a Workshop attendee)', async () => {
    db = mockSupabase({
      ...baseTables(),
      global_persons: { rows: [profile('w-attendee')] },
      persons: { rows: [rosterRow('p-attendee', 'e-pub', 'w-attendee')] },
    });
    expect((await search()).map((row) => row.id)).toEqual(['w-attendee']);
  });

  it('orders by name, then id, so a longer read starts with the shorter one', async () => {
    await search();
    expect(filtersFor(db.from, 'global_persons', 'order')).toEqual([
      ['display_name', { ascending: true }],
      ['id', { ascending: true }],
    ]);
  });

  it('stops after 100 rows, offering only what it has checked', async () => {
    const hidden = Array.from({ length: 120 }, (_, i) => `h${String(i).padStart(3, '0')}`);
    const tables = baseTables();
    tables['global_persons'] = { rows: [...hidden, 'z-open'].map(profile) };
    tables['persons'] = {
      rows: [
        ...hidden.map((id) => rosterRow(`p-${id}`, 'e-pub', id)),
        rosterRow('p-z', 'e-pub', 'z-open'),
      ],
    };
    tables['registrations'] = {
      rows: [...hidden.map((id) => entry(`p-${id}`, 't-secret')), entry('p-z', 't-open')],
    };
    db = mockSupabase(tables);
    expect(await search()).toEqual([]);
    expect(filtersFor(db.from, 'global_persons', 'limit')).toEqual([[20], [40], [60], [80], [100]]);
  });

  it("offers a super admin's profile whatever its entries, reading its roster rows not at all (ruling 176a)", async () => {
    const tables = baseTables();
    tables['global_persons'] = {
      rows: [
        // Made by her draft entry, which carried her HEMA Ratings id: hidden like any other.
        { ...profile('b-draft'), hema_ratings_id: '4242' },
        { ...profile('i-imported'), made_outside_roster: true },
      ],
    };
    tables['persons'] = {
      rows: [
        rosterRow('p-draft', 'e-pub', 'b-draft'),
        rosterRow('p-imported', 'e-pub', 'i-imported'),
      ],
    };
    tables['registrations'] = {
      rows: [entry('p-draft', 't-secret'), entry('p-imported', 't-secret')],
    };
    db = mockSupabase(tables);
    expect((await search()).map((row) => row.id)).toEqual(['i-imported']);
    expect(filtersFor(db.from, 'persons', 'in')[0]).toEqual(['global_person_id', ['b-draft']]);
  });

  it('5xxs when the roster rows cannot be read, never offering everyone', async () => {
    db = mockSupabase({ ...baseTables(), persons: { data: null, error: { message: 'boom' } } });
    const failure = await search().catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(Error);
    expect(failure).not.toBeInstanceOf(HttpException);
    expect(String(failure)).toContain('profile roster read failed: boom');
  });
});
