/**
 * Following a fighter from the People hub counts and follows only the Events the public may know
 * them in (ruling 163, the bar of 129): Tom is entered in the public Spring Open, and in the public
 * Winter Games only in the draft Winter Secret. "Follow everywhere" and the "My groups" cards
 * answer as if his Winter Games row did not exist, for everyone, a member of the club included:
 * the hub spans many Events, so it shows public things only and reads no membership.
 */
import { HttpException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  filtersFor,
  mockSupabase,
  queriedTables,
  type TableSeed,
} from '../../common/testing/supabase-chain';
import { OrganizationsService } from '../organizations/organizations.service';
import { PrivacyService } from '../persons/privacy.service';
import { FollowsService } from './follows.service';

const TOM = '0b9c3a52-7d59-4a57-9f55-1b1f3f5c2a01';
const PAUL = '5d1c0f7e-2a8b-4c3d-9e6f-0a1b2c3d4e5f';

const event = (id: string) => ({
  id,
  status: 'published',
  organization_id: 'org-a',
  event_kind: 'standard',
});
// Tom's roster row in one Event, with the embed the hub reads.
const rosterRow = (id: string, eventId: string) => ({
  id,
  global_person_id: TOM,
  event_id: eventId,
  events: { status: 'published', event_kind: 'standard' },
});
const ROSTER = [rosterRow('p-spring', 'e-spring'), rosterRow('p-winter', 'e-winter')];
// Paul already follows both rows: the Winter Games one from before the fix.
const FOLLOWS = ROSTER.map((row) => ({
  id: `f-${row.id}`,
  event_id: row.event_id,
  followed_person_id: row.id,
  follower_user_id: PAUL,
}));

type Tables = Record<string, TableSeed>;
function baseTables(): Tables {
  return {
    global_persons: {
      rows: [
        {
          id: TOM,
          deleted_at: null,
          merged_into_id: null,
          account_deleted_at: null,
          hide_workshops_publicly: false,
          allow_being_followed: true,
        },
      ],
    },
    persons: { rows: ROSTER },
    events: { rows: [event('e-spring'), event('e-winter')] },
    tournaments: {
      rows: [
        { id: 't-spring', event_id: 'e-spring', status: 'published' },
        { id: 't-winter-secret', event_id: 'e-winter', status: 'draft' },
      ],
    },
    registrations: {
      rows: [
        { person_id: 'p-spring', tournament_id: 't-spring', status: 'registered' },
        { person_id: 'p-winter', tournament_id: 't-winter-secret', status: 'registered' },
      ],
    },
    event_referees: { rows: [] },
    event_instructors: { rows: [] },
    follows: { rows: FOLLOWS },
    directory_follows: { rows: [] },
    // Paul runs the Winter Games' club: the hub still shows him public things only (ruling 163).
    organization_members: { rows: [{ organization_id: 'org-a', user_id: PAUL, role: 'owner' }] },
  };
}

let db: ReturnType<typeof mockSupabase>;
const scheduler = { cancelForFollowedPerson: vi.fn() };

function service() {
  return new FollowsService(
    db as never,
    new PrivacyService(db as never),
    scheduler as never,
    new OrganizationsService(db as never),
  );
}
const followAll = () => service().followAllEvents(TOM, {});
const cards = async () =>
  (await service().countFollowStateForGlobalPersons([TOM], { userId: PAUL })).get(TOM);

beforeEach(() => {
  db = mockSupabase(baseTables());
  scheduler.cancelForFollowedPerson.mockClear();
});

describe('the hub counts and follows only the Events the public may know him in (ruling 163)', () => {
  it('counts one upcoming Event for "follow everywhere", not his draft-only one', async () => {
    expect(await followAll()).toMatchObject({ upcomingEventCount: 1 });
  });

  it('counts one upcoming and one followed Event on his "My groups" card, for a club member too', async () => {
    expect(await cards()).toEqual({ upcomingEventCount: 1, followingEventCount: 1 });
    expect(filtersFor(db.from, 'follows', 'in')).toEqual([['followed_person_id', ['p-spring']]]);
    expect(queriedTables(db.from)).not.toContain('organization_members');
  });

  it('answers exactly as if his hidden row did not exist', async () => {
    const summary = await followAll();
    const card = await cards();
    db = mockSupabase({ ...baseTables(), persons: { rows: ROSTER.slice(0, 1) } });
    expect(await followAll()).toEqual(summary);
    expect(await cards()).toEqual(card);
  });

  it('unfollows him everywhere, his hidden row included', async () => {
    await service().unfollowAllEvents(TOM, { userId: PAUL });
    expect(scheduler.cancelForFollowedPerson.mock.calls).toEqual([
      ['p-spring', PAUL],
      ['p-winter', PAUL],
    ]);
  });

  it.each([
    ['"follow everywhere"', followAll],
    ['the "My groups" card', cards],
  ])('5xxs %s when the Events cannot be read', async (_, read) => {
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
