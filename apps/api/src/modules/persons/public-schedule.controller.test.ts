/**
 * The @Public door onto a person's schedule, driven end to end through the
 * controller and the real service over seeded tables.
 *
 * Two refusals, each in front of every read of the schedule: an Event the
 * caller may not see (a draft, to anyone outside its organisation), and a
 * person who is not in the Event the URL names. Both answer 404, and the second
 * answers exactly what an unknown person gets, so the route confirms nobody.
 */
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import * as jwt from 'jsonwebtoken';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mockSupabase, queriedTables } from '../../common/testing/supabase-chain';
import { GuestJwtService } from '../auth/guest-jwt.service';
import { ParticipantIdentityService } from '../auth/participant-identity.service';
import { PublicScheduleController } from './public-schedule.controller';
import { PublicScheduleService } from './public-schedule.service';

// Plain modules with reads of their own, proven by their own tests.
vi.mock('../schedule/duty-windows', () => ({
  resolveDutyWindows: vi.fn(async () => new Map()),
  resolvePoolSpans: vi.fn(async () => []),
}));
vi.mock('../schedule/match-lengths', () => ({
  resolveMatchLengths: vi.fn(
    async (_db: unknown, _eventId: string, inputs: Array<{ id: string }>) =>
      new Map(inputs.map((input) => [input.id, 5])),
  ),
}));

const DRAFT = '11111111-1111-4111-8111-111111111111';
const OPEN = '22222222-2222-4222-8222-222222222222';
/** Anna fights in the draft Event; Carl in the open one. */
const ANNA = '33333333-3333-4333-8333-333333333333';
const CARL = '44444444-4444-4444-8444-444444444444';
const NOBODY = '55555555-5555-4555-8555-555555555555';

const bout = (id: string, reg: string, tournament: string) => ({
  id,
  match_number_label: id,
  status: 'scheduled',
  scheduled_at: '2027-05-22T09:00:00+00:00',
  phase_id: `ph-${tournament}`,
  pool_id: null,
  planned_duration_override_minutes: null,
  red_score: 0,
  blue_score: 0,
  winner_registration_id: null,
  end_reason: null,
  red_registration_id: reg,
  blue_registration_id: null,
  pools: null,
  lices: null,
  phases: {
    type: 'pool',
    tournaments: {
      id: tournament,
      name: tournament,
      scoring_config_json: null,
      status: 'published',
    },
  },
});

function door(opts: { userId?: string; member?: boolean } = {}) {
  const db = mockSupabase({
    events: {
      rows: [
        { id: DRAFT, status: 'draft', organization_id: 'org-draft', timezone: 'Europe/Paris' },
        { id: OPEN, status: 'published', organization_id: 'org-open', timezone: 'Europe/Paris' },
      ],
    },
    persons: {
      rows: [
        { id: ANNA, event_id: DRAFT, global_person_id: null },
        { id: CARL, event_id: OPEN, global_person_id: null, claimed_by_user_id: 'u-carl' },
      ],
    },
    registrations: {
      rows: [
        { id: 'r-anna', tournament_id: 'draft-open', person_id: ANNA },
        { id: 'r-carl', tournament_id: 'open-open', person_id: CARL },
      ],
    },
    matches: {
      rows: [bout('anna-bout', 'r-anna', 'draft-open'), bout('carl-bout', 'r-carl', 'open-open')],
    },
    referee_assignments: { rows: [] },
    workshop_enrollments: { rows: [] },
    guest_sessions: {
      rows: [
        { id: 'gs-live', revoked_at: null },
        { id: 'gs-signed-out', revoked_at: '2027-05-22T08:00:00+00:00' },
      ],
    },
  });
  const getUser = vi.fn(async () => ({ data: { user: opts.userId ? { id: opts.userId } : null } }));
  const supabase = { ...db, anon: { auth: { getUser } } };
  const orgs = {
    assertOrgRole: vi.fn(async () => {
      if (!opts.member) throw new ForbiddenException('not a member');
    }),
  };
  // Hidden workshops show to the person themself only, as the real PrivacyService does.
  const privacy = {
    canSeeWorkshops: async (person: string, viewer: string | null) => person === viewer,
  };
  const service = new PublicScheduleService(supabase as never, privacy as never, orgs as never);
  const guestJwt = new GuestJwtService({ getOrThrow: () => GUEST_SECRET } as never);
  const identity = new ParticipantIdentityService(supabase as never, guestJwt);
  const controller = new PublicScheduleController(service, identity, supabase as never);
  return { controller, service, from: db.from, orgs };
}

const GUEST_SECRET = 'the-server-guest-secret';
/** A guest cookie the server signed, for a session and person. */
const guest = (sub: string, person: string, event: string) =>
  ({
    headers: {},
    cookies: {
      mc_guest: jwt.sign({ sub, person_id: person, event_id: event, type: 'guest' }, GUEST_SECRET, {
        expiresIn: 3600,
      }),
    },
  }) as never;

const anonymous = { headers: {}, cookies: {} } as never;
const signedIn = { headers: { authorization: 'Bearer t' }, cookies: {} } as never;
const boutsOf = (schedule: { matches: Array<{ id: string }> }) => schedule.matches.map((m) => m.id);

afterEach(() => vi.clearAllMocks());

describe('GET /events/:eventId/people/:personId/schedule', () => {
  it('answers a draft Event with a 404 to anyone outside its organisation, before any read of the schedule', async () => {
    const { controller, from } = door();
    const refusal = controller.getSchedule(DRAFT, ANNA, anonymous);
    await expect(refusal).rejects.toBeInstanceOf(NotFoundException);
    await expect(refusal).rejects.toThrow(`Event "${DRAFT}" not found`);
    expect(queriedTables(from)).toEqual(['events']);

    // Not even the viewer's own guest session is read for a refused request.
    const asGuest = door();
    await expect(
      asGuest.controller.getSchedule(DRAFT, ANNA, guest('gs-live', ANNA, DRAFT)),
    ).rejects.toThrow(`Event "${DRAFT}" not found`);
    expect(queriedTables(asGuest.from)).toEqual(['events']);

    // Signed in is not enough: the account must belong to the organisation.
    const outsider = door({ userId: 'u-outsider', member: false });
    await expect(outsider.controller.getSchedule(DRAFT, ANNA, signedIn)).rejects.toThrow(
      `Event "${DRAFT}" not found`,
    );
    expect(outsider.orgs.assertOrgRole).toHaveBeenCalledWith(
      'org-draft',
      'u-outsider',
      'read_only',
    );
    expect(queriedTables(outsider.from)).toEqual(['events']);
  });

  it("lets a member of the draft Event's organisation read it, as the caller they signed in as", async () => {
    const { controller, orgs } = door({ userId: 'u-organiser', member: true });
    const schedule = await controller.getSchedule(DRAFT, ANNA, signedIn);
    expect(boutsOf(schedule)).toEqual(['anna-bout']);
    expect(orgs.assertOrgRole).toHaveBeenCalledWith('org-draft', 'u-organiser', 'read_only');
  });

  it('answers a person of ANOTHER Event exactly as it answers an unknown person, before any read of the schedule', async () => {
    const other = door();
    const stranger = other.controller.getSchedule(OPEN, ANNA, anonymous);
    await expect(stranger).rejects.toBeInstanceOf(NotFoundException);
    await expect(stranger).rejects.toThrow(`Person "${ANNA}" not found`);
    expect(queriedTables(other.from)).toEqual(['events', 'persons']);

    const unknown = door();
    const nobody = unknown.controller.getSchedule(OPEN, NOBODY, anonymous);
    await expect(nobody).rejects.toBeInstanceOf(NotFoundException);
    await expect(nobody).rejects.toThrow(`Person "${NOBODY}" not found`);
    expect(queriedTables(unknown.from)).toEqual(['events', 'persons']);
  });

  it('answers an Event id that matches nothing with a 404, not with the person', async () => {
    // Before the gate, any id at all served the person's bouts from their own Event.
    const { controller, from } = door();
    await expect(controller.getSchedule(NOBODY, CARL, anonymous)).rejects.toThrow(
      `Person "${CARL}" not found`,
    );
    expect(queriedTables(from)).toEqual(['events', 'persons']);
  });

  it('serves a person of an open Event to anyone', async () => {
    const { controller } = door();
    const schedule = await controller.getSchedule(OPEN, CARL, anonymous);
    expect(boutsOf(schedule)).toEqual(['carl-bout']);
  });

  it("shows a person's hidden workshops only on their own guest session, and not once it is signed out", async () => {
    const { controller } = door();
    // `null` is "hidden"; an empty list is "shown, and there are none".
    const own = await controller.getSchedule(OPEN, CARL, guest('gs-live', CARL, OPEN));
    expect(own.workshops).toEqual([]);
    const signedOut = await controller.getSchedule(OPEN, CARL, guest('gs-signed-out', CARL, OPEN));
    expect(signedOut.workshops).toBeNull();
    const otherEvent = await controller.getSchedule(OPEN, CARL, guest('gs-live', CARL, DRAFT));
    expect(otherEvent.workshops).toBeNull();
    expect((await controller.getSchedule(OPEN, CARL, anonymous)).workshops).toBeNull();
  });

  it('shows a signed-in person their own hidden workshops, and nobody else', async () => {
    const byCookie = { headers: {}, cookies: { 'sb-access-token': 't' } } as never;
    const own = door({ userId: 'u-carl' });
    expect((await own.controller.getSchedule(OPEN, CARL, byCookie)).workshops).toEqual([]);
    const someoneElse = door({ userId: 'u-someone-else' });
    expect((await someoneElse.controller.getSchedule(OPEN, CARL, byCookie)).workshops).toBeNull();
  });
});

describe('PublicScheduleService.getSchedule — the doors that already know who is asking', () => {
  // `/events/:id/my-schedule` and `/me/upcoming` resolve the person from the
  // caller's own identity for that Event, so they pass no gate of their own and
  // must not start failing on one.
  it('reads a draft Event for its own participant', async () => {
    const { service } = door();
    const schedule = await service.getSchedule(DRAFT, ANNA, ANNA);
    expect(boutsOf(schedule)).toEqual(['anna-bout']);
  });
});
