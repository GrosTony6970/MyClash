/**
 * A follow read or write that fails says so (operator ruling 117a).
 *
 * Every query in FollowsService dropped its error: a failed list read showed
 * "you follow nobody", a failed "which of these do I follow" read showed nobody
 * as followed, a failed unfollow answered "done" with the row still there. Each
 * now fails as a plain Error — a 5xx naming what failed — and never guesses.
 * The one exception is the next-bout line read AFTER a saved write (ruling 122,
 * follows.saved-writes.test.ts): the write stands and answers without it.
 */
import { HttpException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import {
  mockSupabase,
  type ChainResult,
  type TableSeed,
} from '../../common/testing/supabase-chain';
import { FollowsService } from './follows.service';

const USER = { userId: '5d1c0f7e-2a8b-4c3d-9e6f-0a1b2c3d4e5f' };
const EVENT = 'e1';
const PERSON = 'p1';
const GLOBAL = 'gp1';
const FAILED: ChainResult = { data: null, error: { message: 'boom' } };
const FOLLOW_ROW = {
  id: 'f1',
  followed_person_id: PERSON,
  created_at: '2026-09-25T00:00:00Z',
  notify_match_start: true,
  notify_workshop_start: false,
  persons: { given_name: 'Ana', family_name: 'Silva', clubs: null },
};

function followsWith(tables: Record<string, TableSeed>) {
  const supabase = mockSupabase(tables);
  const privacy = { getOrCreate: vi.fn().mockResolvedValue({ allowBeingFollowed: true }) };
  const service = new FollowsService(
    supabase as never,
    privacy as never,
    { cancelForFollowedPerson: vi.fn() } as never,
    {} as never,
  );
  return { service, supabase };
}

async function expectFailure(run: Promise<unknown>, message: string) {
  await expect(run).rejects.toThrow(`${message} failed: boom`);
  await expect(run).rejects.not.toBeInstanceOf(HttpException);
}

describe('a failed follow read or write fails loudly (ruling 117a)', () => {
  it('the follows list of one Event', async () => {
    const { service } = followsWith({ follows: FAILED });
    await expectFailure(service.listFollows(EVENT, USER), 'follows read');
  });

  it('the follows list across Events', async () => {
    const { service } = followsWith({ follows: FAILED });
    await expectFailure(service.listAllFollows(USER), 'follows read');
  });

  it('the "already followed?" read, before anything is written', async () => {
    const { service, supabase } = followsWith({ follows: FAILED });
    await expectFailure(service.follow(EVENT, PERSON, USER), 'follows read');
    expect(supabase.writes).toEqual([]);
  });

  it('the follow write', async () => {
    const { service } = followsWith({ follows: [{ data: null, error: null }, FAILED] });
    await expectFailure(service.follow(EVENT, PERSON, USER), 'follow write');
  });

  it('the unfollow', async () => {
    const { service } = followsWith({ follows: FAILED });
    await expectFailure(service.unfollow(EVENT, PERSON, USER), 'follow delete');
  });

  it('the notification toggles', async () => {
    const { service } = followsWith({ follows: FAILED });
    await expectFailure(
      service.updateNotifications(EVENT, PERSON, USER, { notifyMatchStart: false }),
      'follow notifications write',
    );
  });

  it('the next-bout line of a listed follow', async () => {
    const { service } = followsWith({
      follows: { data: [FOLLOW_ROW], error: null },
      registrations: FAILED,
    });
    await expectFailure(service.listFollows(EVENT, USER), 'registrations read');
  });

  it('the next-bout read itself', async () => {
    const { service } = followsWith({
      follows: { data: [FOLLOW_ROW], error: null },
      registrations: { data: [{ id: 'r1' }], error: null },
      matches: FAILED,
    });
    await expectFailure(service.listFollows(EVENT, USER), 'matches read');
  });

  it('the directory unfollow, before the per-Event unfollows run', async () => {
    // One Event to unfollow them in: had its unfollow run first, `follows` would show a write.
    const { service, supabase } = followsWith({
      directory_follows: FAILED,
      persons: {
        data: [
          { id: PERSON, event_id: EVENT, events: { status: 'published', event_kind: 'standard' } },
        ],
        error: null,
      },
      follows: { data: null, error: null },
    });
    await expectFailure(service.unfollowAllEvents(GLOBAL, USER), 'directory follow delete');
    expect(supabase.writes.map((w) => w.table)).toEqual(['directory_follows']);
  });

  it('the Following tab list', async () => {
    const { service } = followsWith({ directory_follows: FAILED });
    await expectFailure(service.listDirectoryFollows(USER.userId), 'directory follows read');
  });

  it('the "which of these do I follow" read', async () => {
    const { service } = followsWith({ directory_follows: FAILED });
    await expectFailure(
      service.filterFollowedGlobalPersons(USER.userId, [GLOBAL]),
      'directory follows read',
    );
  });

  it('the notification state behind the Following tab', async () => {
    const { service } = followsWith({ follows: FAILED });
    await expectFailure(
      service.getEventFollowStateForGlobalPersons(USER.userId, [GLOBAL]),
      'follows read',
    );
  });

  it('the group cards: their Events, then their follows', async () => {
    const people = followsWith({ persons: FAILED });
    await expectFailure(
      people.service.countFollowStateForGlobalPersons([GLOBAL], USER),
      'event people read',
    );

    const follows = followsWith({
      persons: {
        data: [
          {
            id: PERSON,
            global_person_id: GLOBAL,
            event_id: EVENT,
            events: { status: 'published', event_kind: 'standard' },
          },
        ],
        error: null,
      },
      follows: FAILED,
    });
    await expectFailure(
      follows.service.countFollowStateForGlobalPersons([GLOBAL], USER),
      'follows read',
    );
  });

  it("moving a guest session's follows to the claimed account", async () => {
    const guest = followsWith({ follows: FAILED });
    await expectFailure(
      guest.service.migrateGuestFollows('g1', USER.userId, EVENT),
      'guest follows read',
    );

    const own = followsWith({
      follows: [{ data: [{ id: 'f1', followed_person_id: PERSON }], error: null }, FAILED],
    });
    await expectFailure(own.service.migrateGuestFollows('g1', USER.userId, EVENT), 'follows read');

    const write = followsWith({
      follows: [
        { data: [{ id: 'f1', followed_person_id: PERSON }], error: null },
        { data: [], error: null },
        FAILED,
      ],
    });
    await expectFailure(
      write.service.migrateGuestFollows('g1', USER.userId, EVENT),
      'follow write',
    );

    const duplicate = followsWith({
      follows: [
        { data: [{ id: 'f1', followed_person_id: PERSON }], error: null },
        { data: [{ followed_person_id: PERSON }], error: null },
        FAILED,
      ],
    });
    await expectFailure(
      duplicate.service.migrateGuestFollows('g1', USER.userId, EVENT),
      'follow delete',
    );
  });
});
