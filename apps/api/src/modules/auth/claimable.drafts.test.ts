/**
 * The personal space's "is this you?" suggestions, `GET /me/personal-space` `claimable` (ruling
 * 171a, the bar of ruling 164): an unclaimed roster row on her email is left out when its Event is
 * hidden from her, or when that row is entered only in Tournaments hidden from her — unless she is
 * a member of the Event's club or an ACTIVE staff session of it. A hidden row answers exactly as if
 * it did not exist. The membership and staff checks run for real over seeded tables.
 */
import 'reflect-metadata';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  filtersFor,
  mockSupabase,
  selectsFor,
  type TableSeed,
} from '../../common/testing/supabase-chain';
import { OrganizationsService } from '../organizations/organizations.service';
import { AuthService } from './auth.service';

const EMAIL = 'lea@example.com';

const event = (id: string, status: string) => ({
  id,
  status,
  organization_id: 'org-a',
  event_kind: 'standard',
});
const tournament = (id: string, eventId: string, status: string) => ({
  id,
  event_id: eventId,
  status,
});
// An unclaimed roster row on her email, in one Event each.
const row = (id: string, eventId: string, name: string) => ({
  id,
  event_id: eventId,
  given_name: name,
  family_name: 'Martin',
  email: EMAIL,
  claimed_by_user_id: null,
  global_person_id: null,
  events: { name: `Event ${eventId}` },
});
const entry = (personId: string, tournamentId: string) => ({
  person_id: personId,
  tournament_id: tournamentId,
  status: 'registered',
});

const ROSTER = [
  // A live entry in a public Tournament: she may know of it.
  row('p-spring', 'e-spring', 'Spring'),
  // Entered only in the draft Winter Secret of the public Winter Games.
  row('p-winter', 'e-winter', 'Winter'),
  // Of the draft Autumn Cup.
  row('p-autumn', 'e-autumn', 'Autumn'),
  // No entry at all (a Workshop attendee): she may know of it.
  row('p-summer', 'e-summer', 'Summer'),
  // No entry either, but of the draft Fall Cup: the Event itself is hidden.
  row('p-fall', 'e-fall', 'Fall'),
];

type Tables = Record<string, TableSeed>;
function baseTables(): Tables {
  return {
    events: {
      rows: [
        event('e-spring', 'published'),
        event('e-winter', 'published'),
        event('e-autumn', 'draft'),
        event('e-summer', 'published'),
        event('e-fall', 'draft'),
      ],
    },
    tournaments: {
      rows: [
        tournament('t-sabre', 'e-spring', 'published'),
        tournament('t-winter-secret', 'e-winter', 'draft'),
        tournament('t-autumn', 'e-autumn', 'published'),
      ],
    },
    persons: { rows: ROSTER },
    registrations: {
      rows: [
        entry('p-spring', 't-sabre'),
        entry('p-winter', 't-winter-secret'),
        entry('p-autumn', 't-autumn'),
      ],
    },
    event_referees: { rows: [] },
    event_instructors: { rows: [] },
    global_persons: { rows: [] },
    referee_assignments: { rows: [] },
    workshop_enrollments: { rows: [] },
    organization_members: {
      rows: [
        { organization_id: 'org-a', user_id: 'u-clubmate', role: 'read_only' },
        // Léa runs another club: that makes her no insider of this one.
        { organization_id: 'org-b', user_id: 'u-lea', role: 'owner' },
      ],
    },
    event_staff_accounts: {
      rows: [
        { id: 'staff-autumn', event_id: 'e-autumn', status: 'active' },
        { id: 'staff-off', event_id: 'e-autumn', status: 'disabled' },
      ],
    },
  };
}

let db: ReturnType<typeof mockSupabase>;

function service() {
  const supabase = {
    service: db.service,
    getAuthUser: vi.fn(async () => ({ id: 'u-lea', email: EMAIL, user_metadata: {} })),
  };
  const orgs = new OrganizationsService(supabase as never);
  return new AuthService(
    supabase as never,
    {} as never,
    { getOrThrow: vi.fn(), get: vi.fn((_k: string, def?: string) => def ?? '') } as never,
    {} as never,
    {} as never,
    orgs,
  );
}

const signedIn = { headers: { authorization: 'Bearer token' }, cookies: {} };
const withStaff = (staffId: string, eventId: string) => ({
  ...signedIn,
  staffSession: { staffId, eventId },
});
const claimable = async (req: object = signedIn) =>
  (await service().getPersonalSpace(req as never)).claimable;

beforeEach(() => {
  db = mockSupabase(baseTables());
});

describe('the "is this you?" suggestions hide what the draft bar hides from her (ruling 171a)', () => {
  it('offers someone of another club only the rows of public Events she may know of', async () => {
    expect(await claimable()).toEqual([
      { id: 'p-spring', name: 'Spring Martin', eventName: 'Event e-spring' },
      { id: 'p-summer', name: 'Summer Martin', eventName: 'Event e-summer' },
    ]);
  });

  it('answers exactly as if the hidden rows did not exist', async () => {
    const shown = await claimable();
    const known = ROSTER.filter((p) => ['p-spring', 'p-summer'].includes(p.id));
    db = mockSupabase({ ...baseTables(), persons: { rows: known } });
    expect(await claimable()).toEqual(shown);
  });

  it('reads the row Event and decides on it', async () => {
    await claimable();
    expect(selectsFor(db.from, 'persons')).toContain(
      'id, given_name, family_name, email, claimed_by_user_id, event_id, events(name)',
    );
    expect(selectsFor(db.from, 'events')).toEqual(['id, status, organization_id, event_kind']);
    expect(filtersFor(db.from, 'events', 'in')).toEqual([
      ['id', ['e-spring', 'e-winter', 'e-autumn', 'e-summer', 'e-fall']],
    ]);
  });

  it("offers a member of the Event's club every row", async () => {
    const tables = baseTables();
    tables['organization_members'] = {
      rows: [{ organization_id: 'org-a', user_id: 'u-lea', role: 'read_only' }],
    };
    db = mockSupabase(tables);
    expect((await claimable()).map((c) => c.id)).toEqual([
      'p-spring',
      'p-winter',
      'p-autumn',
      'p-summer',
      'p-fall',
    ]);
  });

  it("offers an active staff session its own Event's rows, and nothing hidden of another Event's", async () => {
    expect((await claimable(withStaff('staff-autumn', 'e-autumn'))).map((c) => c.id)).toEqual([
      'p-spring',
      'p-autumn',
      'p-summer',
    ]);
  });

  it('offers a disabled staff session only what an outsider sees', async () => {
    expect((await claimable(withStaff('staff-off', 'e-autumn'))).map((c) => c.id)).toEqual([
      'p-spring',
      'p-summer',
    ]);
  });

  it('keeps a row entered in a public and a draft Tournament, and a referee of the Event (ruling 167); hides a test Event', async () => {
    db = mockSupabase({
      ...baseTables(),
      events: {
        rows: [
          event('e-spring', 'published'),
          event('e-winter', 'published'),
          { ...event('e-test', 'published'), event_kind: 'test' },
        ],
      },
      tournaments: {
        rows: [
          tournament('t-sabre', 'e-spring', 'published'),
          tournament('t-spring-secret', 'e-spring', 'draft'),
          tournament('t-winter-secret', 'e-winter', 'draft'),
          tournament('t-test', 'e-test', 'published'),
        ],
      },
      persons: {
        rows: [
          row('p-both', 'e-spring', 'Both'),
          { ...row('p-referee', 'e-winter', 'Referee'), global_person_id: 'gp-referee' },
          row('p-test', 'e-test', 'Test'),
        ],
      },
      registrations: {
        rows: [
          entry('p-both', 't-sabre'),
          entry('p-both', 't-spring-secret'),
          entry('p-referee', 't-winter-secret'),
          entry('p-test', 't-test'),
        ],
      },
      event_referees: { rows: [{ event_id: 'e-winter', person_id: 'gp-referee' }] },
    });
    expect((await claimable()).map((c) => c.id)).toEqual(['p-both', 'p-referee']);
  });

  it('offers nothing when the Events cannot be read: never a hidden row', async () => {
    db = mockSupabase({ ...baseTables(), events: { data: null, error: { message: 'boom' } } });
    expect(await claimable()).toEqual([]);
  });
});
