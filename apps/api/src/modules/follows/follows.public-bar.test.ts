/**
 * A follow holds the public person page's bar (operator ruling 130).
 *
 * `POST /events/:eventId/follows` checked neither that the caller may see the Event nor that the
 * person is in it, and its 201 echoed the person's name and club: anyone holding a draft Event's
 * ids read its fighters. A guest session of one Event could follow people in another. The fan-out
 * behind the People hub's Follow ("follow them at every upcoming Event") counted and followed
 * draft Events, and the cross-Event follows list then named them.
 */
import {
  ForbiddenException,
  HttpException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { PublicReader } from '../../common/auth/competition-visibility';
import { ANONYMOUS_USER_ID } from '../../common/auth/request-user';
import {
  mockSupabase,
  queriedTables,
  selectsFor,
  writesTo,
  type TableSeed,
} from '../../common/testing/supabase-chain';
import { FollowsService } from './follows.service';

const ORG = 'org-1';
const EVENT = '11111111-1111-4111-8111-111111111111';
const DRAFT_EVENT = '22222222-2222-4222-8222-222222222222';
const TEST_EVENT = '33333333-3333-4333-8333-333333333333';
const PAST_EVENT = '44444444-4444-4444-8444-444444444444';
const OTHER_EVENT = '55555555-5555-4555-8555-555555555555';
const UNKNOWN_EVENT = '66666666-6666-4666-8666-666666666666';
/** Léa fights in all five Events, one event-scoped row each. */
const LEA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const LEA_DRAFT = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const LEA_TEST = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const LEA_PAST = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const STRANGER = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const UNKNOWN_PERSON = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const GP_LEA = '99999999-9999-4999-8999-999999999999';
const MEMBER = 'member-user';
const FAN = { userId: 'fan-user' };

const ANON: PublicReader = { userId: ANONYMOUS_USER_ID, staff: null };
const asUser = (userId: string): PublicReader => ({ userId, staff: null });

const event = (id: string, status: string, eventKind = 'standard') => ({
  id,
  status,
  organization_id: ORG,
  event_kind: eventKind,
});
const EVENTS = [
  event(EVENT, 'published'),
  event(DRAFT_EVENT, 'draft'),
  event(TEST_EVENT, 'published', 'test'),
  event(PAST_EVENT, 'completed'),
  event(OTHER_EVENT, 'published'),
];
const eventOf = (id: string) => {
  const found = EVENTS.find((row) => row.id === id);
  return { status: found?.status, event_kind: found?.event_kind };
};
const person = (id: string, eventId: string) => ({
  id,
  event_id: eventId,
  global_person_id: GP_LEA,
  events: eventOf(eventId),
});

function build(overrides: Record<string, TableSeed> = {}) {
  const supabase = mockSupabase({
    events: { rows: EVENTS },
    persons: {
      rows: [
        person(LEA, EVENT),
        person(LEA_DRAFT, DRAFT_EVENT),
        person(LEA_TEST, TEST_EVENT),
        person(LEA_PAST, PAST_EVENT),
        { ...person(STRANGER, OTHER_EVENT), global_person_id: 'gp-stranger' },
      ],
    },
    global_persons: {
      rows: [{ id: GP_LEA, deleted_at: null, merged_into_id: null, account_deleted_at: null }],
    },
    follows: {
      rows: [],
      returning: (row) => ({ ...row, id: 'f-new', created_at: '2026-09-25T20:00:00Z' }),
    },
    directory_follows: { data: null, error: null },
    registrations: { rows: [] },
    ...overrides,
  });
  const privacy = { getOrCreate: vi.fn().mockResolvedValue({ allowBeingFollowed: true }) };
  const orgs = {
    assertOrgRole: vi.fn(async (orgId: string, userId: string) => {
      if (orgId !== ORG || userId !== MEMBER) throw new ForbiddenException('not a member');
    }),
  };
  const service = new FollowsService(
    supabase as never,
    privacy as never,
    { cancelForFollowedPerson: vi.fn() } as never,
    orgs as never,
  );
  return { service, supabase, privacy };
}

describe('a follow holds the public person page bar (ruling 130)', () => {
  it("follows a person of a public Event, under the caller's account", async () => {
    const { service, supabase } = build();
    await service.followInEvent(EVENT, LEA, FAN, ANON);
    const [insert] = writesTo(supabase, 'follows');
    expect(insert?.row).toMatchObject({
      event_id: EVENT,
      followed_person_id: LEA,
      follower_user_id: 'fan-user',
    });
  });

  it.each([
    ['a draft Event', DRAFT_EVENT, LEA_DRAFT],
    ['a test Event', TEST_EVENT, LEA_TEST],
  ])(
    '%s answers an outsider exactly like an unknown Event, touching nothing',
    async (_c, id, p) => {
      const { service, supabase, privacy } = build();
      const hidden = service.followInEvent(id, p, FAN, asUser('fan-user'));
      await expect(hidden).rejects.toBeInstanceOf(NotFoundException);
      await expect(hidden).rejects.toThrow(`Event "${id}" not found`);
      await expect(service.followInEvent(UNKNOWN_EVENT, p, FAN, ANON)).rejects.toThrow(
        `Event "${UNKNOWN_EVENT}" not found`,
      );
      expect(queriedTables(supabase.from)).toEqual(['events', 'events']);
      expect(privacy.getOrCreate).not.toHaveBeenCalled();
    },
  );

  it("a member of the Event's club still follows in its draft", async () => {
    const { service, supabase } = build();
    await service.followInEvent(DRAFT_EVENT, LEA_DRAFT, { userId: MEMBER }, asUser(MEMBER));
    expect(writesTo(supabase, 'follows')).toHaveLength(1);
  });

  it('a person of another Event answers exactly like an unknown person, touching nothing', async () => {
    const { service, supabase, privacy } = build();
    const stranger = service.followInEvent(EVENT, STRANGER, FAN, ANON);
    await expect(stranger).rejects.toBeInstanceOf(NotFoundException);
    await expect(stranger).rejects.toThrow(`Person "${STRANGER}" not found`);
    await expect(service.followInEvent(EVENT, UNKNOWN_PERSON, FAN, ANON)).rejects.toThrow(
      `Person "${UNKNOWN_PERSON}" not found`,
    );
    expect(queriedTables(supabase.from)).not.toContain('follows');
    expect(privacy.getOrCreate).not.toHaveBeenCalled();
  });

  it('a guest follows inside their own Event', async () => {
    const { service, supabase } = build();
    await service.followInEvent(EVENT, LEA, { guestSessionId: 'g1', guestEventId: EVENT }, ANON);
    const [insert] = writesTo(supabase, 'follows');
    expect(insert?.row).toMatchObject({ follower_guest_session_id: 'g1' });
  });

  it("a follow's next bout is never a draft Tournament's", async () => {
    const bout = (id: string, reg: string, at: string, tournamentStatus: string) => ({
      id,
      match_number_label: id,
      scheduled_at: at,
      status: 'scheduled',
      red_registration_id: reg,
      blue_registration_id: null,
      // The flat key the dotted filter reads on a seeded row (`onlyPublicTournaments`).
      'phases.tournaments.status': tournamentStatus,
    });
    const { service, supabase } = build({
      registrations: {
        rows: [
          { id: 'r-open', person_id: LEA },
          { id: 'r-secret', person_id: LEA },
        ],
      },
      matches: {
        rows: [
          bout('SECRET-M01', 'r-secret', '2026-10-01T08:00:00Z', 'draft'),
          bout('OPEN-M01', 'r-open', '2026-10-01T09:00:00Z', 'published'),
        ],
      },
    });
    const row = await service.followInEvent(EVENT, LEA, FAN, ANON);
    expect(row.nextEvent?.label).toBe('OPEN-M01');
    expect(selectsFor(supabase.from, 'matches')).toEqual([
      'id, match_number_label, scheduled_at, status, phases!inner(tournaments!inner(status))',
    ]);
  });

  it('a guest session that names no Event is nobody: asked to sign in', async () => {
    const { service, supabase } = build();
    await expect(
      service.followInEvent(EVENT, LEA, { guestSessionId: 'g1' }, ANON),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(writesTo(supabase, 'follows')).toEqual([]);
  });

  it('a guest of another Event is nobody here: asked to sign in, nothing written', async () => {
    const { service, supabase } = build();
    const elsewhere = service.followInEvent(
      EVENT,
      LEA,
      { guestSessionId: 'g1', guestEventId: OTHER_EVENT },
      ANON,
    );
    await expect(elsewhere).rejects.toBeInstanceOf(UnauthorizedException);
    expect(writesTo(supabase, 'follows')).toEqual([]);
  });

  it('a failed Event read is a 5xx, never an unknown Event', async () => {
    const { service } = build({ events: { data: null, error: { message: 'boom' } } });
    const run = service.followInEvent(EVENT, LEA, FAN, ANON);
    await expect(run).rejects.toThrow('event read failed: boom');
    await expect(run).rejects.not.toBeInstanceOf(HttpException);
  });
});

describe('following someone at every upcoming Event skips the ones the public cannot see (ruling 130)', () => {
  it('follows and counts only the published, upcoming Event', async () => {
    const { service, supabase } = build();
    const summary = await service.followAllEvents(GP_LEA, FAN);
    expect(summary.upcomingEventCount).toBe(1);
    expect(summary.followedCount).toBe(1);
    expect(
      writesTo(supabase, 'follows').map(
        (write) => (write.row as Record<string, unknown> | undefined)?.['event_id'],
      ),
    ).toEqual([EVENT]);
  });

  it('a guest follows only inside their own Event', async () => {
    const { service, supabase } = build();
    const guest = { guestSessionId: 'g1', guestEventId: OTHER_EVENT };
    const summary = await service.followAllEvents(GP_LEA, guest);
    expect(summary.upcomingEventCount).toBe(0);
    expect(summary.followedCount).toBe(0);
    expect(writesTo(supabase, 'follows')).toEqual([]);
  });

  it('the People hub card counts only the published, upcoming Event', async () => {
    const { service } = build();
    const state = await service.countFollowStateForGlobalPersons([GP_LEA], FAN);
    expect(state.get(GP_LEA)?.upcomingEventCount).toBe(1);
  });

  it('a follow left in a draft Event is not an active one', async () => {
    const { service } = build({
      follows: {
        rows: [
          {
            event_id: DRAFT_EVENT,
            followed_person_id: LEA_DRAFT,
            follower_user_id: 'fan-user',
            persons: { global_person_id: GP_LEA, events: eventOf(DRAFT_EVENT) },
          },
        ],
      },
    });
    const state = await service.getEventFollowStateForGlobalPersons('fan-user', [GP_LEA]);
    expect(state.get(GP_LEA)?.active).toBe(false);
  });
});
