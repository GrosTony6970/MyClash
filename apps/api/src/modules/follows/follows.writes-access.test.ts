/**
 * Who may follow, unfollow and change the notifications of a follow (operator
 * ruling 102): a signed-in account or a guest session, on its OWN follows only.
 * A caller with neither gets a 401 and nothing is read or written.
 *
 * Until 2026-09-24 a caller with no cookie reached the service with the
 * identity `{}`, and every follows query then filtered on no follower at all:
 * an anonymous unfollow deleted EVERY spectator's follow of the person, an
 * anonymous notification change rewrote everyone's, and an anonymous follow got
 * another follower's row back.
 *
 * Driven through the real FollowsService over seeded tables.
 */
import { UnauthorizedException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  mockSupabase,
  queriedTables,
  scopedTo,
  writesTo,
  type TableSeed,
} from '../../common/testing/supabase-chain';
import { FollowsService } from './follows.service';

const EVENT = '11111111-1111-4111-8111-111111111111';
const ANNA = '22222222-2222-4222-8222-222222222222';
const USER = '33333333-3333-4333-8333-333333333333';
const GUEST = '44444444-4444-4444-8444-444444444444';

const ROW = {
  id: 'f-1',
  followed_person_id: ANNA,
  created_at: '2026-09-24T10:00:00Z',
  notify_match_start: true,
  notify_workshop_start: false,
  persons: { given_name: 'Anna', family_name: 'Martin', clubs: null },
};

let db: ReturnType<typeof mockSupabase>;
let privacy: { getOrCreate: ReturnType<typeof vi.fn> };
let follows: FollowsService;

function build(tables: Record<string, TableSeed> = {}) {
  db = mockSupabase({ follows: { data: ROW }, registrations: { rows: [] }, ...tables });
  privacy = { getOrCreate: vi.fn().mockResolvedValue({ allowBeingFollowed: true }) };
  const notifications = { cancelForFollowedPerson: vi.fn().mockResolvedValue(undefined) };
  follows = new FollowsService(
    { service: db.service } as never,
    privacy as never,
    notifications as never,
  );
}

beforeEach(() => build());

const NOBODY = {};
const PATCH = { notifyMatchStart: false };

describe('follows writes (ruling 102)', () => {
  it.each([
    ['unfollow', () => follows.unfollow(EVENT, ANNA, NOBODY)],
    ['change the notifications of', () => follows.updateNotifications(EVENT, ANNA, NOBODY, PATCH)],
    ['follow', () => follows.follow(EVENT, ANNA, NOBODY)],
  ])(
    'refuses a caller with no account and no guest session to %s a person, touching nothing',
    async (_verb, write) => {
      await expect(write()).rejects.toThrow(UnauthorizedException);
      expect(queriedTables(db.from)).toEqual([]);
      expect(privacy.getOrCreate).not.toHaveBeenCalled();
    },
  );

  it("unfollows only the signed-in caller's own follow", async () => {
    await follows.unfollow(EVENT, ANNA, { userId: USER });
    const [write] = writesTo(db, 'follows');
    expect(scopedTo(write, 'follower_user_id')).toBe(USER);
  });

  it("unfollows only the guest session's own follow", async () => {
    await follows.unfollow(EVENT, ANNA, { guestSessionId: GUEST });
    const [write] = writesTo(db, 'follows');
    expect(scopedTo(write, 'follower_guest_session_id')).toBe(GUEST);
  });

  it("changes only the caller's own notifications", async () => {
    await follows.updateNotifications(EVENT, ANNA, { userId: USER }, PATCH);
    const [write] = writesTo(db, 'follows');
    expect(scopedTo(write, 'follower_user_id')).toBe(USER);
  });

  it.each([
    [
      'a guest follow under the guest session',
      { guestSessionId: GUEST },
      'follower_guest_session_id',
      GUEST,
    ],
    ['a signed-in follow under the account', { userId: USER }, 'follower_user_id', USER],
  ])('records %s', async (_label, identity, column, follower) => {
    // No follow yet, then the inserted row read back.
    build({ follows: [{ data: null }, { data: ROW }] });
    await follows.follow(EVENT, ANNA, identity);
    const [insert] = writesTo(db, 'follows');
    expect(insert?.row).toMatchObject({ [column]: follower });
  });

  it('still answers the list reads with nothing when there is no identity', async () => {
    await expect(follows.listFollows(EVENT, NOBODY)).resolves.toEqual([]);
    await expect(follows.listAllFollows(NOBODY)).resolves.toEqual([]);
  });
});
