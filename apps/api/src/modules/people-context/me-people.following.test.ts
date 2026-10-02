/**
 * `GET /me/following` hands each card the hub follow's own switch (operator rulings 217, 217a).
 *
 * The three older switches of a card sit on a follow of ONE Event (`eventFollow`); a person
 * followed from the People hub alone had none. The hub switch is saved on the hub follow, so the
 * list hands it for every person, with or without an Event follow.
 */
import { describe, expect, it, vi } from 'vitest';
import { MePeopleController } from './me-people.controller';

const followed = (globalPersonId: string, notifyRefereeStart: boolean) => ({
  globalPersonId,
  followedAt: '2026-10-01T00:00:00Z',
  notifyRefereeStart,
});
const EVENT_FOLLOW = {
  eventId: 'open',
  personId: 'lea-open',
  notifyMatchStart: true,
  notifyWorkshopStart: false,
  notifyRefereeStart: false,
  active: true,
};

describe('GET /me/following', () => {
  it('hands the hub switch as saved, beside the Event follow that backs the other three', async () => {
    const people = {
      enrich: vi.fn(async (ids: string[]) => ids.map((globalPersonId) => ({ globalPersonId }))),
    };
    const follows = {
      listDirectoryFollows: vi
        .fn()
        .mockResolvedValue([followed('gp-paul', true), followed('gp-lea', false)]),
      getEventFollowStateForGlobalPersons: vi
        .fn()
        .mockResolvedValue(new Map([['gp-lea', EVENT_FOLLOW]])),
    };
    const auth = { getAuthUser: vi.fn().mockResolvedValue({ id: 'u-marc' }) };
    const controller = new MePeopleController(people as never, follows as never, auth as never);

    const cards = await controller.following({
      headers: { authorization: 'Bearer token' },
    } as never);

    expect(follows.listDirectoryFollows).toHaveBeenCalledWith('u-marc');
    expect(cards).toEqual([
      {
        globalPersonId: 'gp-paul',
        followedAt: '2026-10-01T00:00:00Z',
        eventFollow: null,
        hubFollow: { notifyRefereeStart: true },
      },
      {
        globalPersonId: 'gp-lea',
        followedAt: '2026-10-01T00:00:00Z',
        eventFollow: EVENT_FOLLOW,
        hubFollow: { notifyRefereeStart: false },
      },
    ]);
  });
});
