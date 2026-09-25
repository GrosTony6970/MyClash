/**
 * A draft Tournament of a published Event, on the public reads that list an Event's Tournaments
 * (operator ruling 127a, bar of rulings 81-83).
 *
 * The public Event home read every Tournament of the Event, so a draft's name and entrant count
 * were public the moment the Event was. Now a Tournament that is not published, running or
 * completed is left out for anyone but a member of the Event's club or an ACTIVE staff session of
 * the same Event, as if it did not exist.
 *
 * These run the real EventsService over seeded tables, through the controller, so the reader the
 * AuthGuard left on the request is what decides.
 */
import 'reflect-metadata';
import { HttpException } from '@nestjs/common';
import { beforeEach, describe, expect, it } from 'vitest';
import { mockSupabase, queriedTables, selectsFor } from '../../common/testing/supabase-chain';
import { OrganizationsService } from '../organizations/organizations.service';
import { EventsController } from './events.controller';
import { EventsService } from './events.service';

const EVENT_OPEN = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const EVENT_DRAFT = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
/** Every Tournament of this one is public: nobody needs to be asked who they are. */
const EVENT_ALL_PUBLIC = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
/** A published TEST Event: hidden like a draft (rulings 97, 101). */
const EVENT_TEST = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

const EVENTS = [
  {
    id: EVENT_OPEN,
    slug: 'open',
    status: 'published',
    organization_id: 'org-a',
    event_kind: 'standard',
  },
  {
    id: EVENT_DRAFT,
    slug: 'draft',
    status: 'draft',
    organization_id: 'org-a',
    event_kind: 'standard',
  },
  {
    id: EVENT_TEST,
    slug: 'test',
    status: 'published',
    organization_id: 'org-a',
    event_kind: 'test',
  },
  {
    id: EVENT_ALL_PUBLIC,
    slug: 'all-public',
    status: 'running',
    organization_id: 'org-a',
    event_kind: 'standard',
  },
];

const T = (id: string, event_id: string, status: string, sort_order: number) => ({
  id,
  event_id,
  slug: id,
  name: `Tournament ${id}`,
  status,
  sort_order,
  color: null,
  weapon: null,
});

const TOURNAMENTS = [
  T('t-running', EVENT_OPEN, 'running', 1),
  T('t-draft', EVENT_OPEN, 'draft', 2),
  T('t-published', EVENT_OPEN, 'published', 3),
  T('t-archived', EVENT_OPEN, 'archived', 4),
  T('t-completed', EVENT_OPEN, 'completed', 5),
  T('t-in-draft-event', EVENT_DRAFT, 'published', 1),
  T('t-only', EVENT_ALL_PUBLIC, 'published', 1),
  T('t-in-test-event', EVENT_TEST, 'published', 1),
];
const PUBLIC_IDS = ['t-running', 't-published', 't-completed'];
const ALL_IDS = ['t-running', 't-draft', 't-published', 't-archived', 't-completed'];

type Caller = { user?: string; staff?: { staffId: string; eventId: string } };

/** Outsiders of EVENT_OPEN: signed out, a stranger, another club's owner, stale or foreign staff. */
const STRANGERS: Caller[] = [
  {},
  { user: 'u-stranger' },
  { user: 'u-owner-b' },
  { staff: { staffId: 'staff-draft', eventId: EVENT_DRAFT } },
  { staff: { staffId: 'staff-off', eventId: EVENT_OPEN } },
];
const INSIDERS: Caller[] = [
  { user: 'u-member' },
  { staff: { staffId: 'staff-open', eventId: EVENT_OPEN } },
  // The Event's pad, where a stranger once signed in.
  { user: 'u-stranger', staff: { staffId: 'staff-open', eventId: EVENT_OPEN } },
];

let db: ReturnType<typeof mockSupabase>;
let controller: EventsController;

/** Every table the three reads touch, seeded once; a test overrides one to make it fail. */
const SEED: Parameters<typeof mockSupabase>[0] = {
  events: { rows: EVENTS },
  tournaments: { rows: TOURNAMENTS },
  // One fighter entered in a running and a draft Tournament, one only in the draft, and one in the
  // draft Event.
  registrations: {
    rows: [
      {
        tournament_id: 't-running',
        person_id: 'p-both',
        status: 'registered',
        waitlist_position: null,
      },
      {
        tournament_id: 't-draft',
        person_id: 'p-both',
        status: 'registered',
        waitlist_position: null,
      },
      {
        tournament_id: 't-draft',
        person_id: 'p-draft',
        status: 'registered',
        waitlist_position: null,
      },
      {
        tournament_id: 't-in-draft-event',
        person_id: 'p-draft-event',
        status: 'registered',
        waitlist_position: null,
      },
    ],
  },
  persons: {
    rows: [
      {
        id: 'p-both',
        event_id: EVENT_OPEN,
        given_name: 'Ann',
        family_name: 'Both',
        club_id: null,
        hema_ratings_id: null,
        global_person_id: 'gp-both',
        global_persons: null,
      },
      {
        id: 'p-draft',
        event_id: EVENT_OPEN,
        given_name: 'Dan',
        family_name: 'Draft',
        club_id: null,
        hema_ratings_id: null,
        global_person_id: 'gp-draft',
        global_persons: null,
      },
      {
        id: 'p-draft-event',
        event_id: EVENT_DRAFT,
        given_name: 'Eve',
        family_name: 'Early',
        club_id: null,
        hema_ratings_id: null,
        global_person_id: 'gp-draft-event',
        global_persons: null,
      },
    ],
  },
  clubs: { rows: [] },
  event_referees: { rows: [] },
  event_instructors: { rows: [] },
  phases: { rows: [] },
  tournament_phase_venues: { rows: [] },
  organization_members: {
    rows: [
      { organization_id: 'org-a', user_id: 'u-member', role: 'read_only' },
      { organization_id: 'org-b', user_id: 'u-owner-b', role: 'owner' },
    ],
  },
  event_staff_accounts: {
    rows: [
      { id: 'staff-open', event_id: EVENT_OPEN, status: 'active' },
      { id: 'staff-off', event_id: EVENT_OPEN, status: 'disabled' },
      { id: 'staff-draft', event_id: EVENT_DRAFT, status: 'active' },
      { id: 'staff-draft-off', event_id: EVENT_DRAFT, status: 'disabled' },
    ],
  },
};

function build(overrides: Parameters<typeof mockSupabase>[0] = {}) {
  db = mockSupabase({ ...SEED, ...overrides });
  const orgs = new OrganizationsService(db as never);
  const events = new EventsService(db as never, orgs, {} as never, {} as never);
  controller = new EventsController(events, db as never, {} as never, {} as never, orgs);
}

beforeEach(() => build());

/** A request as the AuthGuard leaves it: the login wins the identity, the staff cookie beside it. */
function req(caller: Caller = {}) {
  const identity = caller.user
    ? { kind: 'claimed', userId: caller.user, email: null }
    : caller.staff
      ? { kind: 'staff', ...caller.staff }
      : { kind: 'anonymous' };
  return { headers: {}, cookies: {}, identity, staffSession: caller.staff ?? null } as never;
}

const idsOf = (rows: unknown) => (rows as Array<{ id: string }>).map((row) => row.id);

describe('GET /events/:eventId/tournaments (the public Event home)', () => {
  const list = (eventId: string, caller?: Caller) =>
    controller.listTournaments(eventId, req(caller));

  it('leaves out a draft or archived Tournament for anyone outside the club', async () => {
    for (const caller of STRANGERS) {
      expect(idsOf(await list(EVENT_OPEN, caller)), JSON.stringify(caller)).toEqual(PUBLIC_IDS);
    }
  });

  it("lists every Tournament to a club member and to the Event's active staff", async () => {
    for (const caller of INSIDERS) {
      expect(idsOf(await list(EVENT_OPEN, caller)), JSON.stringify(caller)).toEqual(ALL_IDS);
    }
  });

  it('asks nobody who they are when every Tournament is public, or when nobody is signed in', async () => {
    expect(idsOf(await list(EVENT_ALL_PUBLIC, { user: 'u-stranger' }))).toEqual(['t-only']);
    await list(EVENT_OPEN);
    expect(queriedTables(db.from)).not.toContain('organization_members');
    expect(queriedTables(db.from)).not.toContain('event_staff_accounts');
  });

  it('answers a draft or test Event to an outsider as an unknown one, and lists nothing for an unknown id', async () => {
    const outsiders: Caller[] = [
      {},
      { user: 'u-stranger' },
      { staff: { staffId: 'staff-draft-off', eventId: EVENT_DRAFT } },
      { staff: { staffId: 'staff-open', eventId: EVENT_OPEN } },
    ];
    for (const eventId of [EVENT_DRAFT, EVENT_TEST]) {
      for (const caller of outsiders) {
        await expect(list(eventId, caller), JSON.stringify(caller)).rejects.toThrow(
          `Event "${eventId}" not found`,
        );
      }
    }
    expect(await list('99999999-9999-4999-8999-999999999999')).toEqual([]);
  });

  it('lists a draft or test Event to a club member, and a draft one to its own active staff', async () => {
    expect(idsOf(await list(EVENT_DRAFT, { user: 'u-member' }))).toEqual(['t-in-draft-event']);
    expect(idsOf(await list(EVENT_TEST, { user: 'u-member' }))).toEqual(['t-in-test-event']);
    const ownStaff = { staff: { staffId: 'staff-draft', eventId: EVENT_DRAFT } };
    expect(idsOf(await list(EVENT_DRAFT, ownStaff))).toEqual(['t-in-draft-event']);
  });

  it("reads the Event's status, club and kind, and every column of its Tournaments", async () => {
    await list(EVENT_OPEN);
    expect(selectsFor(db.from, 'events')).toEqual(['status, organization_id, event_kind']);
    // `status` decides what an outsider sees: a narrowed projection without it would hide all.
    expect(selectsFor(db.from, 'tournaments')).toEqual(['*']);
  });

  it.each([
    ['events', 'event read failed: connection reset', {}],
    ['tournaments', 'tournaments read failed: connection reset', {}],
    ['organization_members', 'membership read failed: connection reset', { user: 'u-member' }],
    [
      'event_staff_accounts',
      'staff session read failed: connection reset',
      { staff: { staffId: 'staff-open', eventId: EVENT_OPEN } },
    ],
  ] as Array<[string, string, Caller]>)(
    'fails a failed %s read loudly, never as an outsider or an unknown Event',
    async (table, message, caller) => {
      build({ [table]: { data: null, error: { message: 'connection reset' } } });
      const run = list(EVENT_OPEN, caller);
      await expect(run).rejects.toThrow(message);
      await expect(run).rejects.not.toBeInstanceOf(HttpException);
    },
  );
});

describe('GET /events/:eventSlug/participants (the public roster)', () => {
  const roster = async (caller?: Caller, eventSlug = 'open', includeStaff?: 'true') =>
    (
      (await controller.listParticipants(eventSlug, req(caller), includeStaff)) as Array<{
        globalPersonId: string;
        tournaments: Array<{ id: string }>;
      }>
    )
      .map((row) => `${row.globalPersonId}:${idsOf(row.tournaments).sort().join('+')}`)
      .sort();

  it('leaves out a draft Tournament and whoever is entered only there, for anyone outside the club', async () => {
    for (const caller of STRANGERS) {
      expect(await roster(caller), JSON.stringify(caller)).toEqual(['gp-both:t-running']);
    }
  });

  it("shows every Tournament and entrant to a club member and to the Event's active staff", async () => {
    for (const caller of INSIDERS) {
      expect(await roster(caller), JSON.stringify(caller)).toEqual([
        'gp-both:t-draft+t-running',
        'gp-draft:t-draft',
      ]);
    }
  });

  it('answers a draft Event to an outsider as an unknown one, and opens it to a club member', async () => {
    await expect(controller.listParticipants('draft', req({ user: 'u-stranger' }))).rejects.toThrow(
      'Event "draft" not found',
    );
    expect(await roster({ user: 'u-member' }, 'draft')).toEqual([
      'gp-draft-event:t-in-draft-event',
    ]);
  });

  it('with the Event staff appended, a referee entered only in a draft Tournament shows no Tournament', async () => {
    build({ event_referees: { rows: [{ event_id: EVENT_OPEN, person_id: 'gp-draft' }] } });
    for (const caller of STRANGERS) {
      expect(await roster(caller, 'open', 'true'), JSON.stringify(caller)).toEqual([
        'gp-both:t-running',
        'gp-draft:',
      ]);
    }
    expect(await roster({ user: 'u-member' }, 'open', 'true')).toEqual([
      'gp-both:t-draft+t-running',
      'gp-draft:t-draft',
    ]);
  });

  it("reads each Tournament's status", async () => {
    await roster();
    expect(selectsFor(db.from, 'tournaments')).toEqual(['id, slug, name, color, weapon, status']);
  });

  it.each([
    ['organization_members', 'membership read failed: connection reset'],
    ['tournaments', 'tournaments read failed: connection reset'],
  ])('fails a failed %s read loudly, never as an outsider', async (table, message) => {
    build({ [table]: { data: null, error: { message: 'connection reset' } } });
    const run = controller.listParticipants('open', req({ user: 'u-member' }));
    await expect(run).rejects.toThrow(message);
    await expect(run).rejects.not.toBeInstanceOf(HttpException);
  });
});
