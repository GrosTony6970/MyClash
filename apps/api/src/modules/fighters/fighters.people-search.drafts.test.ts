/**
 * The signed-in people search, `GET /fighters?q=` (rulings 174, 174a): a profile known only through
 * entries hidden from the public — a draft Tournament, a draft or test Event — is left out, a club
 * member of the draft's club included (public things only, ruling 163), and hidden ones do not
 * crowd out the rest. A platform admin, whose merge tool searches here, still finds every profile.
 * A profile claimed by an account or made outside a roster is public whatever its entries (176a).
 */
import 'reflect-metadata';
import { HttpException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  filtersFor,
  mockSupabase,
  queriedTables,
  type TableSeed,
} from '../../common/testing/supabase-chain';
import { FightersController } from './fighters.controller';
import { FightersService } from './fighters.service';

const profile = (id: string) => ({
  id,
  slug: id,
  display_name: `Martin ${id}`,
  given_name: id,
  family_name: 'Martin',
  made_outside_roster: false,
});
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

const RANKED = ['a-open', 'b-draft', 'c-test', 'd-none', 'e-referee'];

type Tables = Record<string, TableSeed>;
function baseTables(): Tables {
  return {
    global_persons: { rows: RANKED.map(profile) },
    events: {
      rows: [
        { id: 'e-pub', status: 'published', organization_id: 'org-a', event_kind: 'standard' },
        { id: 'e-test', status: 'published', organization_id: 'org-a', event_kind: 'test' },
      ],
    },
    tournaments: {
      rows: [
        { id: 't-open', event_id: 'e-pub', status: 'published' },
        { id: 't-secret', event_id: 'e-pub', status: 'draft' },
        { id: 't-rehearsal', event_id: 'e-test', status: 'published' },
      ],
    },
    persons: {
      rows: [
        rosterRow('p-open', 'e-pub', 'a-open'),
        rosterRow('p-draft', 'e-pub', 'b-draft'),
        rosterRow('p-test', 'e-test', 'c-test'),
        rosterRow('p-referee', 'e-pub', 'e-referee'),
      ],
    },
    registrations: {
      rows: [
        entry('p-open', 't-open'),
        entry('p-draft', 't-secret'),
        entry('p-test', 't-rehearsal'),
        entry('p-referee', 't-secret'),
      ],
    },
    event_referees: { rows: [{ event_id: 'e-pub', person_id: 'e-referee' }] },
    event_instructors: { rows: [] },
    // She runs the draft's club: the search still shows public things only (ruling 163).
    organization_members: { rows: [{ organization_id: 'org-a', user_id: 'u-1', role: 'owner' }] },
    platform_roles: { rows: [] },
  };
}

let db: ReturnType<typeof mockSupabase>;
let ranked: string[];
// lookup_global_persons: the ranked ids, `p_limit` of them.
const rpc = vi.fn(async (_name: string, args: { p_limit: number }) => ({
  data: ranked.slice(0, args.p_limit).map((id) => ({ id })),
  error: null,
}));

function search(query: Record<string, unknown> = { q: 'Martin' }) {
  const supabase = { service: { from: db.from, rpc } };
  const service = new FightersService(supabase as never, {} as never);
  const controller = new FightersController(service, {} as never, supabase as never);
  const req = { identity: { kind: 'claimed', userId: 'u-1', email: null } };
  return controller.list(query as never, req as never) as Promise<Array<{ id: string }>>;
}

beforeEach(() => {
  db = mockSupabase(baseTables());
  ranked = RANKED;
  rpc.mockClear();
});

describe('the people search leaves out a profile known only through hidden entries (ruling 174)', () => {
  it('leaves out a draft-only and a test-Event-only profile, even for a member of the club', async () => {
    expect((await search()).map((row) => row.id)).toEqual(['a-open', 'd-none', 'e-referee']);
    expect(queriedTables(db.from)).not.toContain('organization_members');
  });

  it('shows a platform admin every profile, for the merge tool (ruling 174a)', async () => {
    db = mockSupabase({
      ...baseTables(),
      platform_roles: { rows: [{ user_id: 'u-1', role: 'platform_admin' }] },
    });
    expect((await search()).map((row) => row.id)).toEqual(RANKED);
    expect(queriedTables(db.from)).not.toContain('persons');
  });

  it('shows a platform viewer (a lower platform role) only public profiles', async () => {
    db = mockSupabase({
      ...baseTables(),
      platform_roles: { rows: [{ user_id: 'u-1', role: 'platform_viewer' }] },
    });
    expect((await search()).map((row) => row.id)).toEqual(['a-open', 'd-none', 'e-referee']);
  });

  it('lets no hidden profile crowd out a visible one', async () => {
    const hidden = Array.from({ length: 30 }, (_, i) => `h${String(i).padStart(2, '0')}`);
    ranked = [...hidden, 'z-open'];
    db = mockSupabase({
      ...baseTables(),
      global_persons: { rows: ranked.map(profile) },
      persons: {
        rows: [
          ...hidden.map((id) => rosterRow(`p-${id}`, 'e-pub', id)),
          rosterRow('p-z', 'e-pub', 'z-open'),
        ],
      },
      registrations: {
        rows: [...hidden.map((id) => entry(`p-${id}`, 't-secret')), entry('p-z', 't-open')],
      },
    });
    expect((await search()).map((row) => row.id)).toEqual(['z-open']);
    // 24 rows, all hidden; then 24 + 24, which reaches the end.
    expect(rpc.mock.calls.map((call) => call[1].p_limit)).toEqual([24, 48]);
  });

  it('orders the name search by name, then id, so a longer read starts with the shorter one', async () => {
    db = mockSupabase({ ...baseTables(), global_persons: { data: [], error: null } });
    await search({ q: 'Martin', club: 'garde-noire' });
    expect(filtersFor(db.from, 'global_persons', 'order')).toEqual([
      ['family_name', { ascending: true }],
      ['given_name', { ascending: true }],
      ['id', { ascending: true }],
    ]);
  });

  it("shows a claimed profile or a super admin's whatever its entries (rulings 176, 176a)", async () => {
    ranked = ['b-draft', 'i-imported', 'j-rated', 'k-claimed'];
    db = mockSupabase({
      ...baseTables(),
      global_persons: {
        rows: [
          profile('b-draft'),
          { ...profile('i-imported'), made_outside_roster: true },
          // Made by her draft entry, which carried her HEMA Ratings id: hidden like any other.
          { ...profile('j-rated'), hema_ratings_id: '4242' },
          { ...profile('k-claimed'), claimed_by_user_id: 'u-anna' },
        ],
      },
      persons: {
        rows: ranked.map((id) => rosterRow(`p-${id}`, 'e-pub', id)),
      },
      registrations: { rows: ranked.map((id) => entry(`p-${id}`, 't-secret')) },
    });
    expect((await search()).map((row) => row.id)).toEqual(['i-imported', 'k-claimed']);
  });

  it('5xxs when the roster rows cannot be read, never showing everyone', async () => {
    db = mockSupabase({ ...baseTables(), persons: { data: null, error: { message: 'boom' } } });
    const failure = await search().catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(Error);
    expect(failure).not.toBeInstanceOf(HttpException);
    expect(String(failure)).toContain('profile roster read failed: boom');
  });
});
