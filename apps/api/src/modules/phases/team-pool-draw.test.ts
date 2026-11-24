import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { orderTeams, teamDrawOf, teamPoolMap, type DrawTeam } from './team-pool-draw';

/**
 * Team Longsword has eight teams and two Pools. The organiser spreads them by seed (snake) or by a
 * random draw (ruling 971). A team has no club and no rating to spread by.
 */

const team = (
  id: string,
  seed: number | null,
  createdAt = '2026-11-01T10:00:00.000Z',
): DrawTeam => ({
  id,
  seed,
  created_at: createdAt,
});

/** Eight teams in id order, as the read gives them. */
const EIGHT = ['t-a', 't-b', 't-c', 't-d', 't-e', 't-f', 't-g', 't-h'].map((id) => team(id, null));

function refusal(run: () => unknown): { field: string } {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(BadRequestException);
    return (error as BadRequestException).getResponse() as { field: string };
  }
  throw new Error('not refused');
}

describe('teamDrawOf', () => {
  const never = () => {
    throw new Error('no draw seed is drawn');
  };

  it('asks no team draw of an individual Tournament, and refuses a team spread there', () => {
    expect(teamDrawOf('individual', { seed: 7, enforceSkillBalance: true }, never)).toBeNull();
    expect(refusal(() => teamDrawOf('individual', { teamSpread: 'seed' }, never))).toMatchObject({
      code: 'entrant_kind_field',
      field: 'teamSpread',
    });
  });

  it('refuses a team Tournament with no spread, or with a club or skill spread', () => {
    expect(refusal(() => teamDrawOf('team', {}, never)).field).toBe('teamSpread');
    expect(
      refusal(() =>
        teamDrawOf('team', { teamSpread: 'seed', enforceSchoolSeparation: true }, never),
      ).field,
    ).toBe('enforceSchoolSeparation');
    expect(
      refusal(() => teamDrawOf('team', { teamSpread: 'random', enforceSkillBalance: false }, never))
        .field,
    ).toBe('enforceSkillBalance');
  });

  it('spreads by seed with no draw seed, and refuses one', () => {
    expect(teamDrawOf('team', { teamSpread: 'seed' }, never)).toEqual({ teamSpread: 'seed' });
    expect(refusal(() => teamDrawOf('team', { teamSpread: 'seed', seed: 7 }, never)).field).toBe(
      'seed',
    );
  });

  it("draws at random with the body's seed when it sends one", () => {
    expect(teamDrawOf('team', { teamSpread: 'random', seed: 7 }, never)).toEqual({
      teamSpread: 'random',
      drawSeed: 7,
    });
  });

  it("draws at random with the server's seed when the body sends none (never the 42 default)", () => {
    const drawSeed = vi.fn(() => 918_273);
    expect(teamDrawOf('team', { teamSpread: 'random' }, drawSeed)).toEqual({
      teamSpread: 'random',
      drawSeed: 918_273,
    });
    expect(drawSeed).toHaveBeenCalledTimes(1);
  });
});

describe('orderTeams', () => {
  it('orders by seed, no seed last, then the first made, then by id', () => {
    const teams = [
      team('t-z', null, '2026-11-01T09:00:00.000Z'),
      team('t-y', 2),
      team('t-x', null, '2026-11-01T08:00:00.000Z'),
      team('t-w', 1),
      team('t-b', 3, '2026-11-01T10:00:00.000Z'),
      team('t-a', 3, '2026-11-01T10:00:00.000Z'),
    ];
    expect(orderTeams(teams, { teamSpread: 'seed' }).map((t) => t.id)).toEqual([
      't-w',
      't-y',
      't-a',
      't-b',
      't-x',
      't-z',
    ]);
  });

  it('draws one order for one seed, and another for another seed', () => {
    const first = orderTeams(EIGHT, { teamSpread: 'random', drawSeed: 7 }).map((t) => t.id);
    expect(orderTeams(EIGHT, { teamSpread: 'random', drawSeed: 7 }).map((t) => t.id)).toEqual(
      first,
    );
    expect(first).toEqual(DRAW_7);
    expect(orderTeams(EIGHT, { teamSpread: 'random', drawSeed: 8 }).map((t) => t.id)).toEqual(
      DRAW_8,
    );
    expect(DRAW_8).not.toEqual(DRAW_7);
  });
});

describe('teamPoolMap', () => {
  it('snakes the seed order over the Pools: 1 and 4 in Pool 1, 2 and 3 in Pool 2', () => {
    const teams = [team('t-c', 3), team('t-a', 1), team('t-d', 4), team('t-b', 2)];
    expect(teamPoolMap(teams, 2, { teamSpread: 'seed' })).toEqual(
      new Map([
        [0, ['t-a', 't-d']],
        [1, ['t-b', 't-c']],
      ]),
    );
  });

  it('snakes a random draw in the order drawn', () => {
    expect(teamPoolMap(EIGHT, 2, { teamSpread: 'random', drawSeed: 7 })).toEqual(
      new Map([
        [0, [DRAW_7[0], DRAW_7[3], DRAW_7[4], DRAW_7[7]]],
        [1, [DRAW_7[1], DRAW_7[2], DRAW_7[5], DRAW_7[6]]],
      ]),
    );
  });
});

/** The draws of `EIGHT` for seeds 7 and 8, pinned: a change of the shuffle changes a draw. */
const DRAW_7 = ['t-e', 't-g', 't-b', 't-c', 't-d', 't-f', 't-h', 't-a'];
const DRAW_8 = ['t-a', 't-g', 't-f', 't-c', 't-d', 't-h', 't-e', 't-b'];
