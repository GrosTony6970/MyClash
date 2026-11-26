import { NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { expectNoRawIds } from './no-raw-ids.test-helper';
import { tournamentStandings } from './tournament-standings';

const caller = { userId: 'user-1', email: 'a@b.c', clientId: 'c' };
const id = (n: number) => `0000000${n}-aaaa-4bbb-8ccc-00000000000${n}`;

const eventRow = {
  id: id(1),
  name: 'FAL 2026',
  slug: 'fal-2026',
  start_date: '2026-03-14',
  end_date: '2026-03-15',
  status: 'published',
  timezone: 'Europe/Paris',
  city: 'Lyon',
  country: 'FR',
  organization_id: id(3),
  event_kind: 'real',
};

const standings = {
  tournament: { id: id(2), name: 'Longsword', status: 'running' },
  pools: [{ id: id(4), name: 'Pool 1', members: [], standings: [] }],
  bracketSize: 4,
  bracketSlots: [
    {
      id: id(5),
      round: 2,
      position: 1,
      redFighterName: 'Anna Roux',
      blueFighterName: 'Bob Petit',
      redScore: 5,
      blueScore: 3,
      winnerRegistrationId: id(6),
      status: 'completed',
      matchId: id(7),
      redRegistrationId: id(6),
      blueRegistrationId: id(8),
      referees: [{ displayName: 'Ref One' }],
    },
    {
      id: id(9),
      round: 1,
      position: 2,
      redFighterName: 'Cleo Bon',
      blueFighterName: 'Dan Roy',
      redScore: null,
      blueScore: null,
      winnerRegistrationId: null,
      status: 'scheduled',
      matchId: null,
      redRegistrationId: id(2),
      blueRegistrationId: id(3),
      referees: [],
    },
    {
      id: id(9),
      round: 1,
      position: 1,
      redFighterName: 'Eve Lin',
      blueFighterName: 'Fay Sol',
      redScore: 1,
      blueScore: 4,
      winnerRegistrationId: id(4),
      status: 'completed',
      matchId: null,
      redRegistrationId: id(5),
      blueRegistrationId: id(4),
      referees: [],
    },
  ],
};

const poolStandings = {
  rulesetCode: 'TF_v1',
  columns: [
    { key: 'wins', label: 'Wins', type: 'number' },
    { key: 'losses', label: 'Losses', type: 'number' },
  ],
  pools: [
    {
      poolId: id(4),
      poolName: 'Pool 1',
      status: 'in_progress',
      rows: [
        {
          rank: 1,
          registrationId: id(6),
          displayName: 'Anna Roux',
          club: { id: id(1), name: 'Club Lyon', abbreviation: 'CL' },
          status: 'in_progress',
          stats: { wins: 3, losses: 0, secret: 9 },
          decidingTiebreak: null,
        },
        {
          rank: 2,
          registrationId: id(8),
          displayName: 'Bob Petit',
          club: null,
          status: 'in_progress',
          stats: { wins: 1, losses: 2 },
          decidingTiebreak: { key: 'wins', direction: 'desc', mine: 1, theirs: 3 },
        },
      ],
    },
  ],
};

function depsFor(opts: {
  event?: unknown;
  getStandings?: ReturnType<typeof vi.fn>;
  getPoolStandings?: ReturnType<typeof vi.fn>;
}) {
  const maybeSingle = () => Promise.resolve({ data: opts.event ?? null, error: null });
  const chain = { select: () => chain, eq: () => chain, maybeSingle };
  const getStandings = opts.getStandings ?? vi.fn().mockResolvedValue(standings);
  const getPoolStandings = opts.getPoolStandings ?? vi.fn().mockResolvedValue(poolStandings);
  return {
    getStandings,
    getPoolStandings,
    deps: {
      supabase: { service: { from: () => chain } },
      orgs: {},
      events: { getPublicTournamentStandings: getStandings },
      poolStandings: { getPoolStandings },
    } as never,
  };
}

describe('tournament_standings', () => {
  it('maps the pool tables and the bracket rounds, with no id at any depth', async () => {
    const d = depsFor({ event: eventRow });
    const result = await tournamentStandings('fal-2026', 'longsword', caller, d.deps);

    expect(d.getStandings).toHaveBeenCalledWith('fal-2026', 'longsword', {
      userId: 'user-1',
      staff: null,
    });
    // The pool tables come from the pool-standings service, by the Tournament the first call
    // gated, in the by-pool view.
    expect(d.getPoolStandings).toHaveBeenCalledWith(id(2), 'by-pool');
    expect(result).toEqual({
      tournament: { name: 'Longsword', status: 'running' },
      swiss: null,
      pools: [
        {
          name: 'Pool 1',
          status: 'in_progress',
          rows: [
            {
              rank: 1,
              name: 'Anna Roux',
              club: 'CL',
              stats: { Wins: 3, Losses: 0 },
            },
            { rank: 2, name: 'Bob Petit', club: null, stats: { Wins: 1, Losses: 2 } },
          ],
        },
      ],
      bracket: [
        {
          round: 'Semi Final',
          fights: [
            {
              red: 'Eve Lin',
              blue: 'Fay Sol',
              winner: 'Fay Sol',
              score: { red: 1, blue: 4 },
              status: 'completed',
            },
            { red: 'Cleo Bon', blue: 'Dan Roy', winner: null, score: null, status: 'scheduled' },
          ],
        },
        {
          round: 'Final',
          fights: [
            {
              red: 'Anna Roux',
              blue: 'Bob Petit',
              winner: 'Anna Roux',
              score: { red: 5, blue: 3 },
              status: 'completed',
            },
          ],
        },
      ],
    });
    expectNoRawIds(result);
  });

  const slot = (round: number, position: number, red: string) => ({
    ...standings.bracketSlots[0]!,
    round,
    position,
    redFighterName: red,
    winnerRegistrationId: null,
    redScore: null,
    blueScore: null,
  });
  const roundsOf = async (payload: object) => {
    const getStandings = vi.fn().mockResolvedValue({ ...standings, pools: [], ...payload });
    const d = depsFor({ event: eventRow, getStandings });
    const result = (await tournamentStandings('fal-2026', 'longsword', caller, d.deps)) as {
      bracket: { round: string; fights: { red: string }[] }[];
    };
    return result.bracket.map((r) => [r.round, r.fights.map((f) => f.red)]);
  };

  it('names rounds as the app does and shows the bronze bout as a round of its own', async () => {
    expect(
      await roundsOf({
        bracketSize: 8,
        bracketSlots: [slot(1, 0, 'a'), slot(2, 0, 'b'), slot(3, 0, 'gold'), slot(3, 2, 'bronze')],
      }),
    ).toEqual([
      ['Quarter Final', ['a']],
      ['Semi Final', ['b']],
      ['Final', ['gold']],
      ['Bronze Match', ['bronze']],
    ]);
  });

  it('names double-elimination rounds as winners, losers and grand final', async () => {
    expect(
      await roundsOf({
        bracketSize: 4,
        wbRounds: 2,
        lbRounds: 2,
        bracketSlots: [
          slot(1, 0, 'w1'),
          slot(2, 0, 'w2'),
          slot(3, 0, 'l1'),
          slot(4, 0, 'l2'),
          slot(5, 0, 'gf'),
        ],
      }),
    ).toEqual([
      ['Winners Semi Final', ['w1']],
      ['Winners Final', ['w2']],
      ['Losers Round 1', ['l1']],
      ['Losers Round 2', ['l2']],
      ['Grand Final', ['gf']],
    ]);
  });

  it('does not split a bronze bout out of a double-elimination bracket, as the public page', async () => {
    const rounds = await roundsOf({
      bracketSize: 4,
      wbRounds: 2,
      lbRounds: 2,
      phaseType: 'double_elim',
      bracketSlots: [slot(1, 0, 'w1'), slot(2, 0, 'w2'), slot(2, 2, 'lb-final-side')],
    });
    expect(rounds).toEqual([
      ['Winners Semi Final', ['w1']],
      ['Winners Final', ['w2', 'lb-final-side']],
    ]);
  });

  it('says a Swiss Tournament runs Swiss and how far it is, from the payload', async () => {
    const getStandings = vi.fn().mockResolvedValue({
      ...standings,
      pools: [],
      bracketSlots: [],
      swissPhaseId: id(5),
      swissRoundCount: 5,
      swissRoundsCompleted: 2,
    });
    const d = depsFor({ event: eventRow, getStandings });
    const result = await tournamentStandings('fal-2026', 'longsword', caller, d.deps);
    expect(result).toMatchObject({ swiss: { rounds: 5, roundsCompleted: 2 }, pools: [] });
    expectNoRawIds(result);
  });

  it('answers swiss null for a Tournament with no Swiss phase', async () => {
    const getStandings = vi.fn().mockResolvedValue({
      ...standings,
      pools: [],
      bracketSlots: [],
      swissPhaseId: null,
      swissRoundCount: 0,
      swissRoundsCompleted: 0,
    });
    const d = depsFor({ event: eventRow, getStandings });
    expect(await tournamentStandings('fal-2026', 'longsword', caller, d.deps)).toMatchObject({
      swiss: null,
    });
  });

  it('answers no pool tables when the Tournament shows no pools yet', async () => {
    const getStandings = vi.fn().mockResolvedValue({ ...standings, pools: [], bracketSlots: [] });
    const d = depsFor({ event: eventRow, getStandings });
    const result = await tournamentStandings('fal-2026', 'longsword', caller, d.deps);
    expect(result).toMatchObject({ pools: [], bracket: [] });
    expect(d.getPoolStandings).not.toHaveBeenCalled();
  });

  it('refuses an unpublished Tournament as unknown', async () => {
    // The service throws this very NotFound for a missing Tournament and a hidden one alike.
    const getStandings = vi
      .fn()
      .mockRejectedValue(new NotFoundException('Tournament draft-t not found'));
    const d = depsFor({ event: eventRow, getStandings });
    const result = await tournamentStandings('fal-2026', 'draft-t', caller, d.deps);
    expect(result).toEqual({
      refusal: 'No Tournament "draft-t" at FAL 2026 that you can see.',
    });
    expect(d.getPoolStandings).not.toHaveBeenCalled();
  });

  it('lets any other service error through to the scrubbed failure', async () => {
    const getStandings = vi.fn().mockRejectedValue(new Error('db down'));
    const d = depsFor({ event: eventRow, getStandings });
    await expect(tournamentStandings('fal-2026', 'longsword', caller, d.deps)).rejects.toThrow(
      'db down',
    );
  });

  it('refuses an Event the caller cannot read as unknown, before any Tournament read', async () => {
    const d = depsFor({});
    const result = await tournamentStandings('nope', 'longsword', caller, d.deps);
    expect(result).toEqual({ refusal: 'No Event "nope" that you can see.' });
    expect(d.getStandings).not.toHaveBeenCalled();
  });
});
