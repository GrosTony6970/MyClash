/**
 * The follow lists answer a follow of someone the reader may not know of exactly as no follow
 * (rulings 129, 130, 163). Tom fought the public Spring Open (over now); at the upcoming public
 * Winter Games he is entered only in the draft Winter Secret. Paul and Sam each followed both of
 * his rows before the draft existed. Paul runs the Winter Games' club; Sam does not.
 *
 * The Following tab spans many Events, so it shows public things only, for everyone, Paul
 * included (ruling 163): it backs Tom's switches with the Spring Open follow, never the Winter
 * Games one, which would show them "active" while his card names no Event. The one-Event list
 * holds the bar of that Event's own pages (129): Paul still sees his follow there, Sam does not.
 */
import { HttpException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PublicReader } from '../../common/auth/competition-visibility';
import {
  mockSupabase,
  queriedTables,
  selectsFor,
  type TableSeed,
} from '../../common/testing/supabase-chain';
import { OrganizationsService } from '../organizations/organizations.service';
import { FollowsService } from './follows.service';

const TOM = '0b9c3a52-7d59-4a57-9f55-1b1f3f5c2a01';
const PAUL = '5d1c0f7e-2a8b-4c3d-9e6f-0a1b2c3d4e5f';
const SAM = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';

const SPRING = { id: 'e-spring', status: 'completed', name: 'Spring Open', slug: 'spring-open' };
const WINTER = { id: 'e-winter', status: 'published', name: 'Winter Games', slug: 'winter-games' };
const EVENTS = [SPRING, WINTER].map((event) => ({
  ...event,
  organization_id: 'org-a',
  event_kind: 'standard',
}));
const ROWS = [
  { id: 'p-spring', event: SPRING },
  { id: 'p-winter', event: WINTER },
];

// One follow of each of Tom's rows by this follower, with every embed the three lists read.
const followsOf = (follower: string) =>
  ROWS.map(({ id, event }) => ({
    id: `f-${follower}-${id}`,
    event_id: event.id,
    followed_person_id: id,
    follower_user_id: follower,
    created_at: '2026-09-01T00:00:00Z',
    notify_match_start: true,
    notify_workshop_start: false,
    notify_referee_start: false,
    persons: {
      given_name: 'Tom',
      family_name: 'Durand',
      clubs: null,
      global_person_id: TOM,
      events: { status: event.status, event_kind: 'standard' },
    },
    events: { name: event.name, slug: event.slug },
  }));
const FOLLOWS = [...followsOf(PAUL), ...followsOf(SAM)];

function baseTables(): Record<string, TableSeed> {
  return {
    events: { rows: EVENTS },
    persons: {
      rows: ROWS.map(({ id, event }) => ({ id, global_person_id: TOM, event_id: event.id })),
    },
    tournaments: {
      rows: [
        { id: 't-spring', event_id: 'e-spring', status: 'completed' },
        { id: 't-winter-secret', event_id: 'e-winter', status: 'draft' },
      ],
    },
    registrations: {
      rows: [
        { id: 'r-spring', person_id: 'p-spring', tournament_id: 't-spring', status: 'registered' },
        {
          id: 'r-winter',
          person_id: 'p-winter',
          tournament_id: 't-winter-secret',
          status: 'registered',
        },
      ],
    },
    matches: { rows: [] },
    event_referees: { rows: [] },
    event_instructors: { rows: [] },
    follows: { rows: FOLLOWS },
    organization_members: { rows: [{ organization_id: 'org-a', user_id: PAUL, role: 'owner' }] },
  };
}

let db: ReturnType<typeof mockSupabase>;

function service() {
  return new FollowsService(
    db as never,
    {} as never,
    { cancelForFollowedPerson: vi.fn() } as never,
    new OrganizationsService(db as never),
  );
}
const reader = (userId: string): PublicReader => ({ userId, staff: null });
const switchesOf = async (follower: string) =>
  (await service().getEventFollowStateForGlobalPersons(follower, [TOM])).get(TOM);
const listedEvents = async (follower: string) =>
  (await service().listAllFollows({ userId: follower })).map((follow) => follow.eventId);
const winterList = async (follower: string) =>
  (await service().listFollows('e-winter', { userId: follower }, reader(follower))).map(
    (follow) => follow.personId,
  );

beforeEach(() => {
  db = mockSupabase(baseTables());
});

describe('the Following tab shows public follows only, for everyone (ruling 163)', () => {
  it("backs Tom's switches with his Spring Open follow, not the draft-only Winter Games one", async () => {
    expect(await switchesOf(PAUL)).toEqual({
      eventId: 'e-spring',
      personId: 'p-spring',
      notifyMatchStart: true,
      notifyWorkshopStart: false,
      notifyRefereeStart: false,
      active: false,
    });
    expect(selectsFor(db.from, 'follows')[0]).toMatch(/^event_id, followed_person_id,/);
    expect(queriedTables(db.from)).not.toContain('organization_members');
  });

  it('answers exactly as if the hidden follow did not exist', async () => {
    const shown = await switchesOf(SAM);
    db = mockSupabase({ ...baseTables(), follows: { rows: FOLLOWS.filter(isSpring) } });
    expect(await switchesOf(SAM)).toEqual(shown);
  });

  it('shows no switches when Tom is known only through the draft', async () => {
    db = mockSupabase({ ...baseTables(), follows: { rows: FOLLOWS.filter((f) => !isSpring(f)) } });
    expect(await switchesOf(PAUL)).toBeUndefined();
  });

  it('lists only the Spring Open follow across Events, for the club member too', async () => {
    expect(await listedEvents(PAUL)).toEqual(['e-spring']);
    expect(await listedEvents(SAM)).toEqual(['e-spring']);
    expect(selectsFor(db.from, 'follows')[0]).toMatch(/followed_person_id, event_id,/);
  });
});

describe("one Event's follow list holds that Event's bar (ruling 129)", () => {
  it('lists the Winter Games follow to a member of its club', async () => {
    expect(await winterList(PAUL)).toEqual(['p-winter']);
    expect(selectsFor(db.from, 'follows')[0]).toMatch(/followed_person_id, event_id,/);
  });

  it('answers an outsider as if he followed no one there', async () => {
    expect(await winterList(SAM)).toEqual([]);
  });

  it('answers an outsider nothing of a draft Event', async () => {
    const draft = EVENTS.map((e) => (e.id === 'e-winter' ? { ...e, status: 'draft' } : e));
    db = mockSupabase({ ...baseTables(), events: { rows: draft }, tournaments: { rows: [] } });
    expect(await winterList(SAM)).toEqual([]);
    expect(await winterList(PAUL)).toEqual(['p-winter']);
  });
});

describe('a failed Events read fails the list (ruling 117a)', () => {
  it.each([
    ['the Following tab switches', () => switchesOf(PAUL)],
    ['the list across Events', () => listedEvents(PAUL)],
    ["one Event's list", () => winterList(SAM)],
  ])('%s', async (_, read) => {
    db = mockSupabase({ ...baseTables(), events: { data: null, error: { message: 'boom' } } });
    const failure = await read().then(
      () => null,
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(Error);
    expect(failure).not.toBeInstanceOf(HttpException);
    expect(String(failure)).toContain('events read failed: boom');
  });
});

function isSpring(follow: { event_id: string }): boolean {
  return follow.event_id === 'e-spring';
}
