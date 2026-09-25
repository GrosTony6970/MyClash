/**
 * The public person page's header (operator ruling 121a).
 *
 * The page asked `GET /events/:slug/persons/:personId`, a route that never existed, so every
 * participant link said "Person not found". This route gives the header on the person schedule's
 * bar: the Event must be one the caller may see, and the person must be in THAT Event. A hidden
 * Event answers exactly as an unknown Event; a person of another Event exactly as an unknown one.
 */
import { ForbiddenException, HttpException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { PublicReader } from '../../common/auth/competition-visibility';
import { ANONYMOUS_USER_ID } from '../../common/auth/request-user';
import {
  mockSupabase,
  queriedTables,
  selectsFor,
  type ChainResult,
  type TableSeed,
} from '../../common/testing/supabase-chain';
import { PrivacyService } from '../persons/privacy.service';
import { type FollowIdentity, FollowsService } from './follows.service';
import { PublicPersonService } from './public-person.service';

const ORG = 'org-1';
const EVENT = '11111111-1111-4111-8111-111111111111';
const DRAFT_EVENT = '22222222-2222-4222-8222-222222222222';
const TEST_EVENT = '33333333-3333-4333-8333-333333333333';
const OTHER_EVENT = '44444444-4444-4444-8444-444444444444';
const UNKNOWN_EVENT = '55555555-5555-4555-8555-555555555555';
const MARIE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const DRAFT_ONLY = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const WITHDRAWN = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const NO_PROFILE = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const IN_DRAFT_EVENT = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const IN_TEST_EVENT = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const STRANGER = '99999999-9999-4999-8999-999999999999';
const UNKNOWN_PERSON = '88888888-8888-4888-8888-888888888888';
const MEMBER = 'member-user';
const OUTSIDER = 'outsider-user';

const ANON: PublicReader = { userId: ANONYMOUS_USER_ID, staff: null };
const asUser = (userId: string): PublicReader => ({ userId, staff: null });
const FAILED: ChainResult = { data: null, error: { message: 'boom' } };

const person = (id: string, eventId: string, globalPersonId: string | null) => ({
  id,
  event_id: eventId,
  given_name: 'Marie',
  family_name: 'Dupont',
  global_person_id: globalPersonId,
  clubs: { name: 'Salle Dupont' },
});
const privacyOf = (personId: string, allowBeingFollowed = true) => ({
  person_id: personId,
  hide_workshops_publicly: false,
  allow_being_followed: allowBeingFollowed,
});

/** The seeded tables: one person per case, in the Events and Tournaments each case needs. */
const SEED: Record<string, TableSeed> = {
  events: {
    rows: [
      { id: EVENT, status: 'published', organization_id: ORG, event_kind: 'standard' },
      { id: DRAFT_EVENT, status: 'draft', organization_id: ORG, event_kind: 'standard' },
      { id: TEST_EVENT, status: 'published', organization_id: ORG, event_kind: 'test' },
      { id: OTHER_EVENT, status: 'published', organization_id: 'org-2', event_kind: 'standard' },
    ],
  },
  persons: {
    rows: [
      person(MARIE, EVENT, 'gp-marie'),
      person(DRAFT_ONLY, EVENT, 'gp-draft-only'),
      person(WITHDRAWN, EVENT, 'gp-withdrawn'),
      person(NO_PROFILE, EVENT, null),
      person(IN_DRAFT_EVENT, DRAFT_EVENT, 'gp-in-draft'),
      person(IN_TEST_EVENT, TEST_EVENT, 'gp-in-test'),
      person(STRANGER, OTHER_EVENT, 'gp-stranger'),
    ],
  },
  tournaments: {
    rows: [
      { id: 't-open', event_id: EVENT, status: 'published' },
      { id: 't-secret', event_id: EVENT, status: 'draft' },
      { id: 't-draft-event', event_id: DRAFT_EVENT, status: 'published' },
    ],
  },
  registrations: {
    rows: [
      { id: 'r1', person_id: MARIE, tournament_id: 't-open', status: 'checked_in' },
      { id: 'r2', person_id: DRAFT_ONLY, tournament_id: 't-secret', status: 'registered' },
      { id: 'r3', person_id: WITHDRAWN, tournament_id: 't-open', status: 'withdrawn' },
      { id: 'r4', person_id: IN_DRAFT_EVENT, tournament_id: 't-draft-event', status: 'registered' },
    ],
  },
  // A role at another Event is no role here.
  event_referees: {
    rows: [
      { event_id: EVENT, person_id: 'gp-marie' },
      { event_id: OTHER_EVENT, person_id: 'gp-withdrawn' },
    ],
  },
  event_instructors: {
    rows: [
      { event_id: EVENT, person_id: 'gp-draft-only' },
      { event_id: OTHER_EVENT, person_id: 'gp-marie' },
    ],
  },
  person_privacy: {
    rows: [
      privacyOf(MARIE),
      privacyOf(DRAFT_ONLY),
      privacyOf(WITHDRAWN, false),
      privacyOf(NO_PROFILE),
      privacyOf(IN_DRAFT_EVENT),
      privacyOf(IN_TEST_EVENT),
    ],
  },
  follows: {
    rows: [
      { id: 'f1', event_id: EVENT, followed_person_id: MARIE, follower_user_id: 'fan-user' },
      { id: 'f2', event_id: EVENT, followed_person_id: MARIE, follower_guest_session_id: 'g1' },
      { id: 'f3', event_id: OTHER_EVENT, followed_person_id: MARIE, follower_user_id: 'far' },
    ],
  },
};

const tables = (overrides: Record<string, TableSeed>) => ({ ...SEED, ...overrides });

function build(overrides: Record<string, TableSeed> = {}) {
  const supabase = mockSupabase(tables(overrides));
  const orgs = {
    assertOrgRole: vi.fn(async (orgId: string, userId: string) => {
      if (orgId !== ORG || userId !== MEMBER) throw new ForbiddenException('not a member');
    }),
  };
  const privacy = new PrivacyService(supabase as never);
  const follows = new FollowsService(supabase as never, privacy, {} as never);
  const service = new PublicPersonService(supabase as never, orgs as never, privacy, follows);
  return { service, supabase, orgs };
}

const noFollower = () => Promise.resolve<FollowIdentity>({});

describe('the public person header (ruling 121a)', () => {
  it('gives anyone a person of a public Event: name, club, roles, follow settings', async () => {
    const { service, supabase } = build();
    const profile = await service.getProfile(EVENT, MARIE, ANON, noFollower);
    expect(profile).toEqual({
      id: MARIE,
      givenName: 'Marie',
      familyName: 'Dupont',
      clubLabel: 'Salle Dupont',
      roles: ['competitor', 'referee'],
      allowBeingFollowed: true,
      followState: 'not_following',
    });
    // Signed out, there is no follower to look up.
    expect(queriedTables(supabase.from)).not.toContain('follows');
  });

  it('reads the columns it answers with', async () => {
    const { service, supabase } = build();
    await service.getProfile(EVENT, MARIE, ANON, noFollower);
    expect(selectsFor(supabase.from, 'events')).toEqual([
      'id, status, organization_id, event_kind',
    ]);
    expect(selectsFor(supabase.from, 'persons')).toEqual([
      'id, given_name, family_name, global_person_id, clubs(name)',
    ]);
    expect(selectsFor(supabase.from, 'tournaments')).toEqual(['id, status']);
    expect(selectsFor(supabase.from, 'registrations')).toEqual(['id']);
    expect(selectsFor(supabase.from, 'event_referees')).toEqual(['person_id']);
    expect(selectsFor(supabase.from, 'event_instructors')).toEqual(['person_id']);
  });

  describe('a person the caller may not see answers exactly like an unknown one', () => {
    it('a person of another Event, under this Event', async () => {
      const { service } = build();
      const stranger = service.getProfile(EVENT, STRANGER, ANON, noFollower);
      await expect(stranger).rejects.toBeInstanceOf(NotFoundException);
      await expect(stranger).rejects.toThrow(`Person "${STRANGER}" not found`);
      await expect(service.getProfile(EVENT, UNKNOWN_PERSON, ANON, noFollower)).rejects.toThrow(
        `Person "${UNKNOWN_PERSON}" not found`,
      );
    });

    it.each([
      ['a draft Event, to anyone signed out', DRAFT_EVENT, IN_DRAFT_EVENT, ANON],
      ['a draft Event, to a member of another club', DRAFT_EVENT, IN_DRAFT_EVENT, asUser(OUTSIDER)],
      ['a test Event, to anyone signed out', TEST_EVENT, IN_TEST_EVENT, ANON],
    ])('%s', async (_case, eventId, personId, reader) => {
      const { service, supabase } = build();
      const resolveFollower = vi.fn(noFollower);
      const hidden = service.getProfile(eventId, personId, reader, resolveFollower);
      await expect(hidden).rejects.toBeInstanceOf(NotFoundException);
      await expect(hidden).rejects.toThrow(`Event "${eventId}" not found`);
      await expect(service.getProfile(UNKNOWN_EVENT, personId, reader, noFollower)).rejects.toThrow(
        `Event "${UNKNOWN_EVENT}" not found`,
      );
      // Refused before anything about the person was read or who the viewer is was asked: one
      // Event read for the hidden call, one for the unknown one.
      expect(queriedTables(supabase.from)).toEqual(['events', 'events']);
      expect(resolveFollower).not.toHaveBeenCalled();
    });

    it("a member of the Event's club still reads a draft Event's person", async () => {
      const { service } = build();
      const profile = await service.getProfile(
        DRAFT_EVENT,
        IN_DRAFT_EVENT,
        asUser(MEMBER),
        noFollower,
      );
      expect(profile.id).toBe(IN_DRAFT_EVENT);
      expect(profile.roles).toEqual(['competitor']);
    });
  });

  describe('roles', () => {
    it('an entry only in a draft Tournament is no role for an outsider (ruling 127a)', async () => {
      const { service } = build();
      const outsider = await service.getProfile(EVENT, DRAFT_ONLY, asUser(OUTSIDER), noFollower);
      expect(outsider.roles).toEqual(['instructor']);
    });

    it("a member of the Event's club sees the draft entry", async () => {
      const { service } = build();
      const member = await service.getProfile(EVENT, DRAFT_ONLY, asUser(MEMBER), noFollower);
      expect(member.roles).toEqual(['competitor', 'instructor']);
    });

    it('a withdrawn entry is no role', async () => {
      const { service } = build();
      const profile = await service.getProfile(EVENT, WITHDRAWN, ANON, noFollower);
      expect(profile.roles).toEqual([]);
    });

    it('a person with no profile is no referee and no instructor, and costs no staff read', async () => {
      const { service, supabase } = build();
      const profile = await service.getProfile(EVENT, NO_PROFILE, ANON, noFollower);
      expect(profile.roles).toEqual([]);
      expect(queriedTables(supabase.from)).not.toContain('event_referees');
      expect(queriedTables(supabase.from)).not.toContain('event_instructors');
    });
  });

  describe('follow settings', () => {
    it('a person who prefers not to be followed says so', async () => {
      const { service } = build();
      const profile = await service.getProfile(EVENT, WITHDRAWN, ANON, noFollower);
      expect(profile.allowBeingFollowed).toBe(false);
    });

    it.each([
      ['a signed-in follower', { userId: 'fan-user' }, 'following'],
      ['a guest follower', { guestSessionId: 'g1' }, 'following'],
      ['someone who follows her only at another Event', { userId: 'far' }, 'not_following'],
      ['someone else', { userId: 'nobody' }, 'not_following'],
    ])('%s', async (_case, identity: FollowIdentity, followState) => {
      const { service } = build();
      const profile = await service.getProfile(EVENT, MARIE, ANON, () => Promise.resolve(identity));
      expect(profile.followState).toBe(followState);
    });
  });

  describe('a failed read is a 5xx naming what failed, never "unknown" or "no role"', () => {
    it.each([
      ['events', 'event read'],
      ['persons', 'person read'],
      ['tournaments', 'tournaments read'],
      ['registrations', 'registrations read'],
      ['event_referees', 'event referees read'],
      ['event_instructors', 'event instructors read'],
      ['person_privacy', 'privacy read'],
      ['follows', 'follows read'],
    ])('%s', async (table, what) => {
      const { service } = build({ [table]: FAILED });
      const run = service.getProfile(EVENT, MARIE, ANON, () =>
        Promise.resolve({ userId: 'fan-user' }),
      );
      await expect(run).rejects.toThrow(`${what} failed: boom`);
      await expect(run).rejects.not.toBeInstanceOf(HttpException);
    });

    it('a failed club membership read on a draft Event is a 5xx, not a refusal', async () => {
      const { service, orgs, supabase } = build();
      orgs.assertOrgRole.mockRejectedValueOnce(new Error('membership read failed'));
      const run = service.getProfile(DRAFT_EVENT, IN_DRAFT_EVENT, asUser(MEMBER), noFollower);
      await expect(run).rejects.toThrow('membership read failed');
      await expect(run).rejects.not.toBeInstanceOf(HttpException);
      // The Event gate failed it, before the person was read.
      expect(queriedTables(supabase.from)).toEqual(['events']);
    });
  });
});
