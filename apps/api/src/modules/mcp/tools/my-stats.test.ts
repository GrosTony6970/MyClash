import { NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { myStats } from './my-stats';
import { expectNoRawIds } from './no-raw-ids.test-helper';

const caller = { userId: 'user-1', email: 'a@b.c', clientId: 'c' };
const ID = '00000001-aaaa-4bbb-8ccc-000000000001';

const stats = (matches: number, wins: number, losses: number) => ({
  matches,
  wins,
  losses,
  winLossRatio: losses === 0 ? wins : wins / losses,
  doubleHits: 4,
  exchanges: 40,
  doubleHitPercentage: 10,
});

const dashboard = {
  // Every profile field the model must never see.
  profile: {
    id: ID,
    email: 'secret@example.com',
    date_of_birth: '1990-01-01',
    phone: '0600000000',
    claimed_by_user_id: ID,
    display_name: 'Anna',
  },
  career: {
    fighterId: ID,
    stats: {
      overall: stats(10, 6, 3),
      byWeapon: [{ weapon: 'Longsword', ...stats(10, 6, 3) }],
      byYear: [{ year: '2026', ...stats(10, 6, 3) }],
      byEvent: [{ eventId: ID, eventKey: ID, weapon: 'Longsword', eventName: 'FAL' }],
    },
    currentStreak: { kind: 'win', count: 2 },
    tournamentsAttended: 3,
    penalties: [{ eventId: ID, card: 'yellow', category: 'x' }],
    protests: [{ eventId: ID }],
  },
  refereeStats: {
    totalMatches: 12,
    averageRefereeTimeMs: 90000,
    eventsWorked: 2,
    roles: { arbitre_declarant: 5, arbitre_assesseur: 4, arbitre_table: 3 },
    cards: { yellow: 1, red: 0, black: 0 },
    bestBuddies: [{ userId: ID, displayName: 'Bob', matchesTogether: 4 }],
    history: [{ matchId: ID, redFighterName: 'Zed' }],
  },
  hemaRatings: {
    id: '1234',
    name: 'Anna',
    detailsUrl: 'https://hemaratings.com/fighters/details/1234/',
    ratings: [{ weapon: 'Longsword', rank: 42, weightedRating: 1500, category: 'open' }],
  },
};

const depsOf = (getMyDashboard: unknown) => ({ fighters: { getMyDashboard } }) as never;

describe('my_stats', () => {
  it('answers the career and referee numbers, by name', async () => {
    const getMyDashboard = vi.fn().mockResolvedValue(dashboard);
    const result = await myStats(caller, depsOf(getMyDashboard));

    expect(getMyDashboard).toHaveBeenCalledWith('user-1');
    expect(result).toEqual({
      career: {
        bouts: 10,
        wins: 6,
        losses: 3,
        draws: 1,
        winLossRatio: 2,
        doubleHits: 4,
        exchanges: 40,
        doubleHitPercentage: 10,
        currentStreak: { kind: 'win', count: 2 },
        tournamentsAttended: 3,
        byWeapon: [{ weapon: 'Longsword', bouts: 10, wins: 6, losses: 3 }],
      },
      refereeing: {
        totalMatches: 12,
        averageRefereeTimeMs: 90000,
        eventsWorked: 2,
        roles: { arbitre_declarant: 5, arbitre_assesseur: 4, arbitre_table: 3 },
        cards: { yellow: 1, red: 0, black: 0 },
      },
      hemaRatings: [{ weapon: 'Longsword', rank: 42, weightedRating: 1500 }],
    });
    expectNoRawIds(result);
  });

  it('has no email, date_of_birth, phone or buddy at any depth', async () => {
    const result = await myStats(caller, depsOf(vi.fn().mockResolvedValue(dashboard)));
    const text = JSON.stringify(result);
    for (const word of [
      'email',
      'date_of_birth',
      'phone',
      'secret@',
      'Bob',
      'Zed',
      'bestBuddies',
    ]) {
      expect(text).not.toContain(word);
    }
  });

  it('answers no ratings when none are linked', async () => {
    const result = await myStats(
      caller,
      depsOf(vi.fn().mockResolvedValue({ ...dashboard, hemaRatings: null })),
    );
    expect(result).toMatchObject({ hemaRatings: [] });
  });

  it('refuses an account with no fighter profile', async () => {
    const result = await myStats(
      caller,
      depsOf(vi.fn().mockRejectedValue(new NotFoundException('no profile'))),
    );
    expect(result).toEqual({ refusal: 'You have no fighter profile yet.' });
  });

  it('lets any other error through: it is not "no fighter profile"', async () => {
    await expect(
      myStats(caller, depsOf(vi.fn().mockRejectedValue(new Error('db down')))),
    ).rejects.toThrow('db down');
  });
});
