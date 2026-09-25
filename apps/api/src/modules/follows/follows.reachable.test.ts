/**
 * Following a fighter from the People hub reaches only a live profile
 * (operator ruling 112).
 *
 * `POST /me/follows/by-global-person` wrote a follow for any id it was given:
 * an erased profile, one merged into another, one that no longer exists. For an
 * id that names no one, the write failed on its foreign key, the failure was
 * ignored, and the answer still said `following: true`. An erased or merged
 * profile now answers exactly like an unknown one, a 404, and nothing is
 * written; a failed read or write is a 5xx, never a quiet "done".
 */
import { HttpException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import {
  mockSupabase,
  selectsFor,
  type ChainResult,
  type TableSeed,
} from '../../common/testing/supabase-chain';
import { FollowsService } from './follows.service';

const LIVE = '0b9c3a52-7d59-4a57-9f55-1b1f3f5c2a01';
const ERASED = '1c8d4b63-8e6a-4b68-8a66-2c2a4a6d3b12';
const MERGED = '2d7e5c74-9f7b-4c79-9b77-3d3b5b7e4c23';
const DELETED = '3e6f6d85-a08c-4d8a-8c88-4e4c6c8f5d34';
const UNKNOWN = '4f506e96-b19d-4e9b-9d99-5f5d7d906e45';
const USER = '5d1c0f7e-2a8b-4c3d-9e6f-0a1b2c3d4e5f';
const FAILED: ChainResult = { data: null, error: { message: 'boom' } };

const profile = (id: string, gone: Record<string, string> = {}) => ({
  id,
  deleted_at: null,
  merged_into_id: null,
  account_deleted_at: null,
  ...gone,
});

const TABLES: Record<string, TableSeed> = {
  global_persons: {
    rows: [
      profile(LIVE),
      profile(ERASED, { account_deleted_at: '2026-09-01T00:00:00Z' }),
      profile(MERGED, { merged_into_id: LIVE }),
      profile(DELETED, { deleted_at: '2026-09-01T00:00:00Z' }),
    ],
  },
  persons: { data: [], error: null },
  // A write that succeeds: "nothing was written" can only fail against one.
  directory_follows: { data: null, error: null },
};

function followsWith(tables: Record<string, TableSeed>) {
  const supabase = mockSupabase(tables);
  const service = new FollowsService(
    supabase as never,
    { getOrCreate: vi.fn() } as never,
    { cancelForFollowedPerson: vi.fn() } as never,
    {} as never,
  );
  return { service, supabase };
}

describe('following a fighter from the People hub (ruling 112)', () => {
  it('follows a live profile', async () => {
    const { service, supabase } = followsWith(TABLES);

    const summary = await service.followAllEvents(LIVE, { userId: USER });

    expect(summary.following).toBe(true);
    expect(supabase.writes.map((w) => [w.table, w.op, w.row])).toEqual([
      ['directory_follows', 'upsert', { follower_user_id: USER, followed_global_person_id: LIVE }],
    ]);
    expect(selectsFor(supabase.from, 'global_persons')).toEqual(['id']);
    expect(selectsFor(supabase.from, 'persons')).toEqual([
      'id, event_id, events!inner(status, event_kind)',
    ]);
  });

  it.each([
    ['an erased profile', ERASED],
    ['a profile merged into another', MERGED],
    ['a deleted profile', DELETED],
    ['an id that names no one', UNKNOWN],
  ])('answers %s with the same 404, and writes nothing', async (_what, id) => {
    const { service, supabase } = followsWith(TABLES);

    const follow = service.followAllEvents(id, { userId: USER });

    await expect(follow).rejects.toBeInstanceOf(NotFoundException);
    await expect(follow).rejects.toThrow(`Fighter ${id} not found`);
    expect(supabase.writes).toEqual([]);
  });

  it('answers a signed-out caller about an erased profile with the same 404', async () => {
    const { service } = followsWith(TABLES);

    await expect(service.followAllEvents(ERASED, {})).rejects.toThrow(
      `Fighter ${ERASED} not found`,
    );
  });

  it.each([
    ['the profile read', { global_persons: FAILED }, 'fighter read failed: boom'],
    ['the event people read', { persons: FAILED }, 'event people read failed: boom'],
    ['the follow write', { directory_follows: FAILED }, 'directory follow write failed: boom'],
  ])(
    'fails a failed %s loudly, never as a follow that happened',
    async (_what, broken, message) => {
      const { service } = followsWith({ ...TABLES, ...broken });

      const follow = service.followAllEvents(LIVE, { userId: USER });

      await expect(follow).rejects.toThrow(message);
      await expect(follow).rejects.not.toBeInstanceOf(HttpException);
    },
  );

  it('fails an unfollow whose event people read failed, never as a clean 204', async () => {
    // The same read: read as "no events", the event follows stayed and kept notifying.
    const { service } = followsWith({ ...TABLES, persons: FAILED });

    const unfollow = service.unfollowAllEvents(LIVE, { userId: USER });

    await expect(unfollow).rejects.toThrow('event people read failed: boom');
    await expect(unfollow).rejects.not.toBeInstanceOf(HttpException);
  });
});
