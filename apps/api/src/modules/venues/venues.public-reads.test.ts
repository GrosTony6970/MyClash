/**
 * The three public venue reads: the venues an Event uses (by id and by slug)
 * and a Tournament's venue per phase (rulings 81-83, 96).
 *
 * Until 2026-09-24 the slug read checked nothing, and the two id reads answered
 * a draft Event with a 404 while an unknown id got an empty answer — so the
 * difference said "this draft exists" (ruling 78's first cut). The phase read
 * also showed a DRAFT Tournament of a published Event. Now a hidden Event or
 * Tournament answers an outsider exactly as an unknown one: [] for the Event's
 * venues, no venue for any phase, and one 404 in `hidden()`'s words for an
 * unknown or hidden slug (it used to leave out the quotes). A member of the
 * Event's club and an ACTIVE staff session of the same Event still read them.
 *
 * Driven through the controller and the real service over seeded tables.
 */
import 'reflect-metadata';
import { HttpException } from '@nestjs/common';
import { beforeEach, describe, expect, it } from 'vitest';
import { mockSupabase, queriedTables, selectsFor } from '../../common/testing/supabase-chain';
import { OrganizationsService } from '../organizations/organizations.service';
import { VenuesController } from './venues.controller';
import { VenuesService } from './venues.service';

const ORG_A = '11111111-1111-4111-8111-111111111111';
const VENUE_OPEN = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const VENUE_DRAFT = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const VENUE_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const EVENT_OPEN = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const EVENT_DRAFT = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
/** A published Event whose own Tournament is not: EVENT_OPEN's staff are strangers here. */
const EVENT_B = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const T_OPEN = '44444444-4444-4444-8444-444444444444';
const T_IN_DRAFT_EVENT = '55555555-5555-4555-8555-555555555555';
const T_DRAFT = '66666666-6666-4666-8666-666666666666';
const NOBODY = '99999999-9999-4999-8999-999999999999';

const EVENTS = [
  { id: EVENT_OPEN, organization_id: ORG_A, status: 'published', slug: 'open' },
  { id: EVENT_DRAFT, organization_id: ORG_A, status: 'draft', slug: 'secret' },
  { id: EVENT_B, organization_id: ORG_A, status: 'published', slug: 'b' },
];
const eventOf = (id: string) => EVENTS.find((event) => event.id === id)!;
const tournament = (id: string, status: string, eventId: string) => ({
  id,
  event_id: eventId,
  status,
  // The `events!inner(...)` embed, as PostgREST hands it back.
  events: eventOf(eventId),
});
/** Each Event, and each Tournament's pool phase, has its own venue, so an answer names the row. */
const VENUE_OF: Record<string, string> = {
  [EVENT_OPEN]: VENUE_OPEN,
  [EVENT_DRAFT]: VENUE_DRAFT,
  [EVENT_B]: VENUE_B,
};

let db: ReturnType<typeof mockSupabase>;
let controller: VenuesController;

/** Every table but `events`. */
const TABLES = {
  venues: {
    rows: Object.values(VENUE_OF).map((id) => ({
      id,
      organization_id: ORG_A,
      name: `Hall ${id}`,
      venue_areas: [],
      venue_lices: [],
    })),
  },
  event_venues: {
    rows: Object.entries(VENUE_OF).map(([eventId, venueId]) => ({
      event_id: eventId,
      venue_id: venueId,
    })),
  },
  lices: { rows: [] },
  workshop_sessions: { rows: [] },
  tournaments: {
    rows: [
      tournament(T_OPEN, 'running', EVENT_OPEN),
      tournament(T_IN_DRAFT_EVENT, 'running', EVENT_DRAFT),
      tournament(T_DRAFT, 'draft', EVENT_B),
    ],
  },
  tournament_phase_venues: {
    rows: [T_OPEN, T_IN_DRAFT_EVENT, T_DRAFT].map((id) => ({
      tournament_id: id,
      phase_kind: 'pool',
      venues: { id: `hall-of-${id}`, name: 'Hall' },
    })),
  },
  organization_members: {
    rows: [
      { organization_id: ORG_A, user_id: 'u-member', role: 'read_only' },
      { organization_id: 'org-b', user_id: 'u-owner-b', role: 'owner' },
    ],
  },
  event_staff_accounts: {
    rows: [
      { id: 'staff-draft', event_id: EVENT_DRAFT, status: 'active' },
      { id: 'staff-off', event_id: EVENT_DRAFT, status: 'disabled' },
      { id: 'staff-open', event_id: EVENT_OPEN, status: 'active' },
      { id: 'staff-b', event_id: EVENT_B, status: 'active' },
    ],
  },
};

function build(events: Parameters<typeof mockSupabase>[0][string]) {
  db = mockSupabase({ events, ...TABLES });
  const supabase = { service: db.service };
  const service = new VenuesService(supabase as never, new OrganizationsService(supabase as never));
  controller = new VenuesController(service, supabase as never);
}

beforeEach(() => build({ rows: EVENTS }));

type Caller = { user?: string; staff?: { staffId: string; eventId: string } };

/** A request as the AuthGuard leaves it: the login wins the identity, the staff cookie is kept beside it. */
function req(caller: Caller = {}) {
  const identity = caller.user
    ? { kind: 'claimed', userId: caller.user, email: null }
    : caller.staff
      ? { kind: 'staff', ...caller.staff }
      : { kind: 'anonymous' };
  return { headers: {}, cookies: {}, identity, staffSession: caller.staff ?? null } as never;
}

/** The answer, or the refusal's status and body, with the ref blanked so two refs compare. */
async function answer(call: Promise<unknown>, ref: string): Promise<string> {
  const result = await call.then(
    (value) => ({ value }),
    (error: unknown) => {
      if (!(error instanceof HttpException)) throw error;
      return { status: error.getStatus(), refused: error.getResponse() };
    },
  );
  return JSON.stringify(result).replaceAll(ref, '<ref>');
}

interface Route {
  call: (ref: string, r: never) => Promise<unknown>;
  unknown: string;
  unknownAnswer: unknown;
  visible: string;
  /** Each hidden ref, with the active staff session of its own Event. */
  hidden: Array<{ ref: string; staff: { staffId: string; eventId: string } }>;
}

const DRAFT_EVENT_STAFF = { staffId: 'staff-draft', eventId: EVENT_DRAFT };
const ROUTES: Record<string, Route> = {
  eventVenues: {
    call: (id, r) => controller.listForEvent(id, r),
    unknown: NOBODY,
    unknownAnswer: { value: [] },
    visible: EVENT_OPEN,
    hidden: [{ ref: EVENT_DRAFT, staff: DRAFT_EVENT_STAFF }],
  },
  eventVenuesBySlug: {
    call: (slug, r) => controller.listForEventSlug(slug, r),
    unknown: 'nope',
    unknownAnswer: {
      status: 404,
      refused: { message: 'Event "<ref>" not found', error: 'Not Found', statusCode: 404 },
    },
    visible: 'open',
    hidden: [{ ref: 'secret', staff: DRAFT_EVENT_STAFF }],
  },
  phaseVenues: {
    call: (id, r) => controller.getTournamentPhaseVenues(id, r),
    unknown: NOBODY,
    unknownAnswer: { value: { pool: null, swiss: null, bracket: null } },
    visible: T_OPEN,
    hidden: [
      { ref: T_IN_DRAFT_EVENT, staff: DRAFT_EVENT_STAFF },
      { ref: T_DRAFT, staff: { staffId: 'staff-b', eventId: EVENT_B } },
    ],
  },
};

const STRANGERS: Caller[] = [
  {},
  { user: 'u-stranger' },
  { user: 'u-owner-b' },
  { staff: { staffId: 'staff-open', eventId: EVENT_OPEN } },
  { staff: { staffId: 'staff-off', eventId: EVENT_DRAFT } },
  { user: 'u-stranger', staff: { staffId: 'staff-open', eventId: EVENT_OPEN } },
];

describe.each(Object.keys(ROUTES))('%s (rulings 81-83, 96)', (name) => {
  const route = ROUTES[name]!;
  const call = (ref: string, caller?: Caller) => answer(route.call(ref, req(caller)), ref);

  it('answers an unknown ref with the unknown answer', async () => {
    expect(await call(route.unknown)).toBe(JSON.stringify(route.unknownAnswer));
  });

  it('shows a public Event or Tournament to anyone, signed out included', async () => {
    const shown = await call(route.visible);
    expect(shown).not.toBe(await call(route.unknown));
    expect(await call(route.visible, { user: 'u-stranger' })).toBe(shown);
  });

  it('answers a hidden one to outsiders exactly as an unknown ref', async () => {
    const unknown = await call(route.unknown);
    for (const { ref } of route.hidden) {
      for (const caller of STRANGERS) {
        expect(await call(ref, caller), `${ref} ${JSON.stringify(caller)}`).toBe(unknown);
      }
    }
  });

  it("shows a hidden one's own venues to a club member and to its Event's active staff", async () => {
    const unknown = await call(route.unknown);
    for (const { ref, staff } of route.hidden) {
      const own = await call(ref, { user: 'u-member' });
      expect(own, ref).not.toBe(unknown);
      expect(await call(ref, { staff }), ref).toBe(own);
      // The Event's pad, where a stranger once signed in.
      expect(await call(ref, { user: 'u-stranger', staff }), ref).toBe(own);
    }
  });

  it('reads the deciding columns, and a signed-out read costs no membership read', async () => {
    await call(route.visible);
    for (const { ref } of route.hidden) await call(ref);
    const table = name === 'phaseVenues' ? 'tournaments' : 'events';
    const deciding =
      name === 'phaseVenues'
        ? 'status, events!inner(id, status, organization_id)'
        : 'id, status, organization_id';
    expect(new Set(selectsFor(db.from, table))).toEqual(new Set([deciding]));
    expect(queriedTables(db.from)).not.toContain('organization_members');
    expect(queriedTables(db.from)).not.toContain('event_staff_accounts');
  });
});

describe('the venues of the right Event (rulings 81-83, 96)', () => {
  it("lists each Event's own venue, by id and by slug", async () => {
    const ids = (rows: unknown) => (rows as Array<{ id: string }>).map((row) => row.id);
    expect(ids(await controller.listForEvent(EVENT_OPEN, req()))).toEqual([VENUE_OPEN]);
    expect(ids(await controller.listForEventSlug('open', req()))).toEqual([VENUE_OPEN]);
    const member = req({ user: 'u-member' });
    expect(ids(await controller.listForEvent(EVENT_DRAFT, member))).toEqual([VENUE_DRAFT]);
    expect(ids(await controller.listForEventSlug('secret', member))).toEqual([VENUE_DRAFT]);
  });

  it('fails a failed deciding read loudly, never as an unknown ref', async () => {
    build({ data: null, error: { message: 'connection reset' } });
    for (const call of [
      () => controller.listForEvent(EVENT_OPEN, req()),
      () => controller.listForEventSlug('open', req()),
    ]) {
      await expect(call()).rejects.toThrow(/^event read failed: connection reset$/);
      await expect(call()).rejects.not.toBeInstanceOf(HttpException);
    }
  });
});
