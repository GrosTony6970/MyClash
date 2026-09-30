/**
 * The personal-space dashboard, `GET /me/personal-space` (ruling 172, the bar of ruling 164): her
 * lists and counts leave out a claimed roster row entered only in Tournaments hidden from her or
 * of an Event hidden from her, a duty in such an Event or in a Tournament hidden from her, a
 * Workshop of such an Event — unless she is a member of the Event's club or an ACTIVE staff
 * session of it. A hidden row answers exactly as if it did not exist. The membership and staff
 * checks run for real over seeded tables. ("My events" also drops a test Event for everyone; here
 * its insiders still see it.)
 */
import 'reflect-metadata';
import { HttpException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  filtersFor,
  mockSupabase,
  selectsFor,
  type TableSeed,
} from '../../common/testing/supabase-chain';
import { OrganizationsService } from '../organizations/organizations.service';
import { AuthService } from './auth.service';

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
// A roster row she has claimed, in one Event each.
const claimed = (id: string, eventId: string) => ({
  id,
  event_id: eventId,
  given_name: 'Léa',
  family_name: 'Martin',
  email: 'lea@example.com',
  claimed_by_user_id: 'u-lea',
  global_person_id: 'gp-lea',
  events: { id: eventId },
});
const entry = (personId: string, tournamentId: string) => ({
  person_id: personId,
  tournament_id: tournamentId,
  status: 'registered',
});
// A duty on a piste has no Tournament; a Pool or bout duty reaches its Tournament.
const duty = (id: string, eventId: string, day: number) => ({
  id,
  person_id: 'gp-lea',
  event_id: eventId,
  created_at: `2026-03-0${day}T00:00:00Z`,
  pool_id: null as string | null,
  pools: null as unknown,
  matches: null as unknown,
});
const inPool = (row: ReturnType<typeof duty>, tournamentId: string) => ({
  ...row,
  pool_id: `pool-${row.id}`,
  pools: { phases: { tournament_id: tournamentId } },
});
const onBout = (row: ReturnType<typeof duty>, tournamentId: string) => ({
  ...row,
  matches: { id: `m-${row.id}`, phases: { tournament_id: tournamentId } },
});
const workshop = (id: string, eventId: string, day: number) => ({
  id,
  user_id: 'u-lea',
  enrolled_at: `2026-02-0${day}T00:00:00Z`,
  workshop_sessions: { id: `s-${id}`, workshops: { id: `w-${id}`, event_id: eventId } },
});

const CLAIMED = [
  // A live entry in a public Tournament.
  claimed('p-spring', 'e-spring'),
  // Entered only in the draft Winter Secret of the public Winter Games.
  claimed('p-winter', 'e-winter'),
  // Of the draft Autumn Cup.
  claimed('p-autumn', 'e-autumn'),
];
// Newest first, as the dashboard lists them.
const DUTIES = [
  duty('ra-autumn', 'e-autumn', 5),
  onBout(duty('ra-bout-secret', 'e-winter', 4), 't-winter-secret'),
  onBout(duty('ra-bout-open', 'e-winter', 3), 't-winter-open'),
  inPool(duty('ra-pool-secret', 'e-winter', 2), 't-winter-secret'),
  duty('ra-piste', 'e-winter', 1),
];
const WORKSHOPS = [workshop('we-autumn', 'e-autumn', 2), workshop('we-spring', 'e-spring', 1)];

type Tables = Record<string, TableSeed>;
function baseTables(): Tables {
  return {
    events: {
      rows: [
        event('e-spring', 'published'),
        event('e-winter', 'published'),
        event('e-autumn', 'draft'),
      ],
    },
    tournaments: {
      rows: [
        tournament('t-sabre', 'e-spring', 'published'),
        tournament('t-winter-secret', 'e-winter', 'draft'),
        tournament('t-winter-open', 'e-winter', 'published'),
        tournament('t-autumn', 'e-autumn', 'published'),
      ],
    },
    persons: { rows: CLAIMED },
    registrations: {
      rows: [
        entry('p-spring', 't-sabre'),
        entry('p-winter', 't-winter-secret'),
        entry('p-autumn', 't-autumn'),
      ],
    },
    event_referees: { rows: [] },
    event_instructors: { rows: [] },
    global_persons: { rows: [{ id: 'gp-lea', claimed_by_user_id: 'u-lea' }] },
    referee_assignments: { rows: DUTIES },
    workshop_enrollments: { rows: WORKSHOPS },
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
    getAuthUser: vi.fn(async () => ({ id: 'u-lea', email: 'lea@example.com', user_metadata: {} })),
  };
  return new AuthService(
    supabase as never,
    {} as never,
    { getOrThrow: vi.fn(), get: vi.fn((_k: string, def?: string) => def ?? '') } as never,
    {} as never,
    {} as never,
    new OrganizationsService(supabase as never),
  );
}

const signedIn = { headers: { authorization: 'Bearer token' }, cookies: {} };
const withStaff = (staffId: string, eventId: string) => ({
  ...signedIn,
  staffSession: { staffId, eventId },
});
const space = (req: object = signedIn) => service().getPersonalSpace(req as never);
const ids = (rows: Record<string, unknown>[]) => rows.map((row) => row['id']);
async function shown(req?: object) {
  const answer = await space(req);
  return {
    claimed: ids(answer.profiles.claimedPersons),
    duties: ids(answer.commitments.refereeAssignments),
    workshops: ids(answer.commitments.workshopEnrollments),
    counts: answer.counts,
  };
}
const failure = () =>
  space().then(
    () => null,
    (error: unknown) => error,
  );

beforeEach(() => {
  db = mockSupabase(baseTables());
});

describe('the personal-space dashboard hides what the draft bar hides from her (ruling 172)', () => {
  it('shows someone of another club only what she may know of, and counts only that', async () => {
    expect(await shown()).toEqual({
      claimed: ['p-spring'],
      duties: ['ra-bout-open', 'ra-piste'],
      workshops: ['we-spring'],
      counts: { claimedPersons: 1, events: 1, refereeAssignments: 2, workshopEnrollments: 1 },
    });
  });

  it('answers exactly as if the hidden rows did not exist', async () => {
    const before = await space();
    db = mockSupabase({
      ...baseTables(),
      persons: { rows: CLAIMED.filter((p) => p.id === 'p-spring') },
      referee_assignments: {
        rows: DUTIES.filter((d) => ['ra-piste', 'ra-bout-open'].includes(d.id)),
      },
      workshop_enrollments: { rows: WORKSHOPS.filter((w) => w.id === 'we-spring') },
    });
    expect(await space()).toEqual(before);
  });

  it("shows a member of the Event's club everything", async () => {
    db = mockSupabase({
      ...baseTables(),
      organization_members: {
        rows: [{ organization_id: 'org-a', user_id: 'u-lea', role: 'read_only' }],
      },
    });
    expect(await shown()).toEqual({
      claimed: ['p-spring', 'p-winter', 'p-autumn'],
      duties: ['ra-autumn', 'ra-bout-secret', 'ra-bout-open', 'ra-pool-secret', 'ra-piste'],
      workshops: ['we-autumn', 'we-spring'],
      counts: { claimedPersons: 3, events: 3, refereeAssignments: 5, workshopEnrollments: 2 },
    });
  });

  it("shows an active staff session its own Event, and nothing hidden of another Event's", async () => {
    expect(await shown(withStaff('staff-autumn', 'e-autumn'))).toEqual({
      claimed: ['p-spring', 'p-autumn'],
      duties: ['ra-autumn', 'ra-bout-open', 'ra-piste'],
      workshops: ['we-autumn', 'we-spring'],
      counts: { claimedPersons: 2, events: 2, refereeAssignments: 3, workshopEnrollments: 2 },
    });
  });

  it('shows a disabled staff session only what an outsider sees', async () => {
    expect(await shown(withStaff('staff-off', 'e-autumn'))).toEqual(await shown());
  });

  it("reads each duty's Tournament and each row's Event", async () => {
    await space();
    expect(selectsFor(db.from, 'referee_assignments')).toEqual([
      'id, event_id, role, created_at, events(id, slug, name), pool_id, pools(phases(tournament_id)), matches(id, phase_id, status, scheduled_at, ended_at, phases(tournament_id))',
    ]);
    expect(selectsFor(db.from, 'workshop_enrollments')).toEqual([
      'id, status, enrolled_at, workshop_sessions(id, starts_at, ends_at, workshops(id, title, event_id, events(id, slug, name)))',
    ]);
    expect(new Set(selectsFor(db.from, 'events'))).toEqual(
      new Set(['id, status, organization_id, event_kind']),
    );
    const eventLists = filtersFor(db.from, 'events', 'in').map(([, list]) => list);
    expect(eventLists).toEqual(
      expect.arrayContaining([
        ['e-spring', 'e-winter', 'e-autumn'],
        ['e-autumn', 'e-winter'],
        ['e-autumn', 'e-spring'],
      ]),
    );
  });

  // Each list alone: a filter that swallowed its failure would show that list's hidden rows.
  it.each([
    ['her claimed rows', 'persons'],
    ['her duties', 'referee_assignments'],
    ['her Workshops', 'workshop_enrollments'],
  ])('5xxs when the Events of %s cannot be read, never showing a hidden row', async (_, list) => {
    const others: Tables = {
      persons: { rows: [] },
      referee_assignments: { rows: [] },
      workshop_enrollments: { rows: [] },
    };
    delete others[list];
    db = mockSupabase({
      ...baseTables(),
      ...others,
      events: { data: null, error: { message: 'boom' } },
    });
    const error = await failure();
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(HttpException);
    expect(String(error)).toContain('events read failed: boom');
  });

  it("5xxs when an Event's Tournaments cannot be read", async () => {
    db = mockSupabase({ ...baseTables(), tournaments: { data: null, error: { message: 'boom' } } });
    const error = await failure();
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(HttpException);
    expect(String(error)).toContain('tournaments read failed: boom');
  });
});
