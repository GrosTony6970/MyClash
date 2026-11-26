import { NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { myFightHistory } from './my-fight-history';
import { expectNoRawIds } from './no-raw-ids.test-helper';

const caller = { userId: 'user-1', email: 'a@b.c', clientId: 'c' };
const T1 = '00000001-aaaa-4bbb-8ccc-000000000001';
const M = (n: number) => `0000000${n}-aaaa-4bbb-8ccc-0000000000${n}${n}`.slice(0, 36);

const form = (n: number, outcome: string) => ({
  matchId: M(n),
  date: `2026-03-${10 + n}T09:00:00Z`,
  outcome,
  ourScore: 5,
  opponentScore: 3,
});
const match = (n: number, status = 'completed', tournamentId = T1) => ({
  id: M(n),
  tournamentId,
  status,
  opponentName: null,
});

const career = {
  recentForm: [form(2, 'win'), form(1, 'loss')],
  matches: [match(1), match(2), match(3, 'scheduled')],
  tournamentPlacements: [
    {
      tournamentId: T1,
      tournamentName: 'Longsword',
      tournamentSlug: 'longsword',
      eventId: T1,
      eventName: 'FAL 2026',
      eventSlug: 'fal-2026',
      place: 1,
    },
  ],
};

const depsOf = (getMyDashboard: unknown) => ({ fighters: { getMyDashboard } }) as never;

describe('my_fight_history', () => {
  it('lists the bouts newest first with the event and Tournament by name', async () => {
    const getMyDashboard = vi.fn().mockResolvedValue({ profile: {}, career });
    const result = await myFightHistory(caller, depsOf(getMyDashboard), 10);

    expect(getMyDashboard).toHaveBeenCalledWith('user-1');
    expect(result).toEqual({
      total: 2,
      fights: [
        {
          eventName: 'FAL 2026',
          eventSlug: 'fal-2026',
          tournamentName: 'Longsword',
          tournamentSlug: 'longsword',
          date: '2026-03-12T09:00:00Z',
          result: 'win',
          myScore: 5,
          opponentScore: 3,
        },
        {
          eventName: 'FAL 2026',
          eventSlug: 'fal-2026',
          tournamentName: 'Longsword',
          tournamentSlug: 'longsword',
          date: '2026-03-11T09:00:00Z',
          result: 'loss',
          myScore: 5,
          opponentScore: 3,
        },
      ],
    });
    expectNoRawIds(result);
  });

  it('cuts the list at the limit and defaults to 10', async () => {
    const many = Array.from({ length: 10 }, (_, i) => form(i % 9 || 9, 'win'));
    const getMyDashboard = vi
      .fn()
      .mockResolvedValue({ career: { ...career, recentForm: many, matches: [] } });
    const three = await myFightHistory(caller, depsOf(getMyDashboard), 3);
    expect((three as { fights: unknown[] }).fights).toHaveLength(3);
    const dflt = await myFightHistory(caller, depsOf(getMyDashboard));
    expect((dflt as { fights: unknown[] }).fights).toHaveLength(10);
  });

  it('names a bout whose Tournament is unknown with nulls, not a crash', async () => {
    const getMyDashboard = vi.fn().mockResolvedValue({
      career: { ...career, matches: [], tournamentPlacements: [] },
    });
    const result = await myFightHistory(caller, depsOf(getMyDashboard));
    expect((result as { fights: unknown[] }).fights[0]).toMatchObject({
      eventName: null,
      eventSlug: null,
      tournamentName: null,
      tournamentSlug: null,
    });
  });

  it('keeps a bout whose match is known but whose Tournament has no placement, names null', async () => {
    const getMyDashboard = vi.fn().mockResolvedValue({
      career: { ...career, tournamentPlacements: [] },
    });
    const result = await myFightHistory(caller, depsOf(getMyDashboard), 1);
    expect(result).toEqual({
      total: 2,
      fights: [
        {
          eventName: null,
          eventSlug: null,
          tournamentName: null,
          tournamentSlug: null,
          date: '2026-03-12T09:00:00Z',
          result: 'win',
          myScore: 5,
          opponentScore: 3,
        },
      ],
    });
  });

  it('the owner of a hidden profile still sees their own fights', async () => {
    const getMyDashboard = vi
      .fn()
      .mockResolvedValue({ profile: { is_hidden: true, visibility: 'hidden' }, career });
    const result = (await myFightHistory(caller, depsOf(getMyDashboard))) as {
      fights: unknown[];
    };
    expect(result.fights).toHaveLength(2);
  });

  it('refuses an account with no fighter profile', async () => {
    const result = await myFightHistory(
      caller,
      depsOf(vi.fn().mockRejectedValue(new NotFoundException('no profile'))),
    );
    expect(result).toEqual({ refusal: 'You have no fighter profile yet.' });
  });

  it('lets any other error through: it is not "no fighter profile"', async () => {
    await expect(
      myFightHistory(caller, depsOf(vi.fn().mockRejectedValue(new Error('db down')))),
    ).rejects.toThrow('db down');
  });
});
