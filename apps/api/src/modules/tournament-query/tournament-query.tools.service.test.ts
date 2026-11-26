import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TournamentQueryToolsService } from './tournament-query.tools.service';
import { expectNoRawIds } from '../mcp/tools/no-raw-ids.test-helper';
import {
  awaitableChain,
  fighterRows,
  GP_JEAN,
  GP_MARIE,
  M1,
  M2,
  M3,
  POOL_A,
  POOL_B,
  REG_ADA,
  REG_GRACE_H,
  refereeRows,
  tournament,
  uuid,
} from './tournament-query.tools.fixtures';

const summariesMock = vi.hoisted(() => vi.fn());
vi.mock('../matches/match-summaries', () => ({ matchSummaries: summariesMock }));

// Same per-table dispatch pattern as the other API service tests: one fromMock
// reused, branched by tableName.

const fromMock = vi.fn();
const mockSupabase = { service: { from: fromMock } };
const poolStandings = { getPoolStandings: vi.fn() };

describe('TournamentQueryToolsService · get_judge_stats', () => {
  let service: TournamentQueryToolsService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new TournamentQueryToolsService(mockSupabase as never, poolStandings as never);
    fromMock.mockImplementation((tableName: string) => {
      if (tableName === 'vw_tournament_query_referees') {
        return awaitableChain({ data: refereeRows, error: null });
      }
      return awaitableChain({ data: [], error: null });
    });
  });

  it('aggregates a judge matched by name, in any letter case', async () => {
    const result = await service.execute(tournament, 'get_judge_stats', { judge: 'jean dup' });

    expect(result.title).toBe('Judge stats for Jean Dupont');
    expect(result.card).toEqual({ Assignments: 2, Pools: 2, Matches: 2 });
    expectNoRawIds(result);
  });

  it('aggregates another judge by name', async () => {
    const result = await service.execute(tournament, 'get_judge_stats', { judge: 'Marie Martin' });

    expect(result.title).toBe('Judge stats for Marie Martin');
    expect(result.card).toEqual({ Assignments: 1, Pools: 1, Matches: 0 });
  });

  it('does not fall back to every judge when the name is blank', async () => {
    // A blank filter must not become "matches everyone": contains('') is true
    // for every row.
    const result = await service.execute(tournament, 'get_judge_stats', { judge: '   ' });

    expect(result.render_hint).toBe('empty');
    expect(result.metadata?.notes).toContain('No judge assignments found');
    expect(result.card).toBeUndefined();
  });

  it('reports nothing for a judge who is not in this event', async () => {
    const result = await service.execute(tournament, 'get_judge_stats', { judge: 'Nobody' });

    expect(result.render_hint).toBe('empty');
    expect(result.metadata?.notes).toContain('No judge assignments found');
  });

  it('does not take an id for a name', async () => {
    const result = await service.execute(tournament, 'get_judge_stats', { judge: GP_JEAN });

    expect(result.render_hint).toBe('empty');
  });

  describe('two referees share the text', () => {
    const row = (person: string, name: string, pool: string) => ({
      ...refereeRows[0]!,
      person_id: person,
      judge_name: name,
      pool_id: pool,
      match_id: null,
    });
    const both = [
      row(GP_JEAN, 'Marie Curie', POOL_A),
      row(GP_JEAN, 'Marie Curie', POOL_B),
      row(GP_MARIE, 'Marie Dupont', POOL_A),
    ];

    beforeEach(() => {
      fromMock.mockImplementation((tableName: string) =>
        awaitableChain({
          data: tableName === 'vw_tournament_query_referees' ? both : [],
          error: null,
        }),
      );
    });

    it('lists each referee by name when the text fits several people', async () => {
      const result = await service.execute(tournament, 'get_judge_stats', { judge: 'Marie' });

      expect(result.title).toBe('Several referees match "Marie"');
      expect(result.items?.map((item) => item.label)).toEqual(['Marie Curie', 'Marie Dupont']);
      expect(result.card).toBeUndefined();
      expectNoRawIds(result);
    });

    it('gives only the numbers of the one person the whole name fits', async () => {
      const result = await service.execute(tournament, 'get_judge_stats', {
        judge: ' marie curie ',
      });

      expect(result.title).toBe('Judge stats for Marie Curie');
      expect(result.card).toEqual({ Assignments: 2, Pools: 2, Matches: 0 });
      expectNoRawIds(result);
    });

    it('lets an exact name win over a longer name that contains it', async () => {
      fromMock.mockImplementation((tableName: string) =>
        awaitableChain({
          data:
            tableName === 'vw_tournament_query_referees'
              ? [...both, row(uuid(99), 'Marie Curie-Sklodowska', POOL_B)]
              : [],
          error: null,
        }),
      );

      const result = await service.execute(tournament, 'get_judge_stats', { judge: 'Marie Curie' });

      expect(result.title).toBe('Judge stats for Marie Curie');
      expect(result.card).toEqual({ Assignments: 2, Pools: 2, Matches: 0 });
    });
  });
});

describe('TournamentQueryToolsService · getToolContext', () => {
  it('lists the pools by name, and reads nothing else of them', async () => {
    const chains: Record<string, ReturnType<typeof awaitableChain>> = {
      tournaments: awaitableChain({ data: [{ weapon: 'longsword' }], error: null }),
      vw_tournament_query_pools: awaitableChain({
        data: [{ pool_name: 'Pool A' }, { pool_name: 'Pool A' }, { pool_name: 'Pool B' }],
        error: null,
      }),
      lices: awaitableChain({ data: [{ sort_order: 0 }], error: null }),
    };
    fromMock.mockImplementation((tableName: string) => chains[tableName]);
    const service = new TournamentQueryToolsService(mockSupabase as never, poolStandings as never);

    const context = await service.getToolContext(tournament);

    expect(context.poolNames).toEqual(['Pool A', 'Pool B']);
    const pools = chains['vw_tournament_query_pools'] as unknown as Record<
      string,
      ReturnType<typeof vi.fn>
    >;
    expect(pools['select']).toHaveBeenCalledWith('pool_name');
    expect(pools['eq']).toHaveBeenCalledWith('tournament_id', tournament.tournamentId);
  });
});

describe('TournamentQueryToolsService · the doubles ceiling', () => {
  let service: TournamentQueryToolsService;

  // Three bouts between the same pair, one per ceiling reason. Only the first
  // is a loss for both; the draw belongs in neither column and the
  // result-stands bout names a real winner.
  const matchRows = [
    {
      tournament_id: tournament.tournamentId,
      match_id: M1,
      phase_type: 'pool',
      pool_name: 'Pool A',
      status: 'completed',
      red_registration_id: REG_ADA,
      blue_registration_id: REG_GRACE_H,
      red_name: 'Ada Lovelace',
      blue_name: 'Grace Hopper',
      red_score: 0,
      blue_score: 0,
      winner_registration_id: null,
      end_reason: 'max_doubles',
    },
    {
      tournament_id: tournament.tournamentId,
      match_id: M2,
      phase_type: 'pool',
      pool_name: 'Pool A',
      status: 'completed',
      red_registration_id: REG_ADA,
      blue_registration_id: REG_GRACE_H,
      red_name: 'Ada Lovelace',
      blue_name: 'Grace Hopper',
      red_score: 0,
      blue_score: 0,
      winner_registration_id: null,
      end_reason: 'max_doubles_draw',
    },
    {
      tournament_id: tournament.tournamentId,
      match_id: M3,
      phase_type: 'pool',
      pool_name: 'Pool A',
      status: 'completed',
      red_registration_id: REG_ADA,
      blue_registration_id: REG_GRACE_H,
      red_name: 'Ada Lovelace',
      blue_name: 'Grace Hopper',
      red_score: 2,
      blue_score: 0,
      winner_registration_id: REG_ADA,
      end_reason: 'max_doubles_result_stands',
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    service = new TournamentQueryToolsService(mockSupabase as never, poolStandings as never);
    fromMock.mockImplementation((tableName: string) => {
      if (tableName === 'vw_tournament_query_matches') {
        return awaitableChain({ data: matchRows, error: null });
      }
      if (tableName === 'vw_tournament_query_fighters') {
        return awaitableChain({ data: fighterRows, error: null });
      }
      return awaitableChain({ data: [], error: null });
    });
  });

  it('counts a double loss as a loss, not as a bout nobody lost', async () => {
    // It has no winner, so the winner test credited neither side while the bout
    // still counted toward `Matches` — deflating the win rate the organiser is
    // shown and the one the assistant reasons from. The view carries
    // `end_reason` from migration 0193; before that it could not be seen here
    // at all.
    const red = await service.execute(tournament, 'get_fighter_stats', { fighter: 'Ada' });
    const blue = await service.execute(tournament, 'get_fighter_stats', { fighter: 'Hopper' });

    // Red won m-3, lost m-1 (double loss); m-2 is a draw and counts as neither.
    expect(red.card).toMatchObject({ Matches: 3, Wins: 1, Losses: 1 });
    // Blue lost m-1 (double loss) and m-3 (red won it).
    expect(blue.card).toMatchObject({ Matches: 3, Wins: 0, Losses: 2 });
  });
});

describe('TournamentQueryToolsService · find_matches names each bout', () => {
  const bout = {
    match_id: M1,
    match_number_label: 'L1-PD-M01',
    pool_name: 'Pool 4',
    lice_name: 'Lice 1',
    red_name: 'Ada',
    blue_name: 'Grace',
    status: 'scheduled',
    scheduled_at: null,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    fromMock.mockImplementation(() => awaitableChain({ data: [bout], error: null }));
  });

  it('by its code, never by its stored label', async () => {
    summariesMock.mockResolvedValue(new Map([[M1, { roundCode: 'LSW-P4-M01' }]]));
    const service = new TournamentQueryToolsService(mockSupabase as never, poolStandings as never);

    const result = await service.execute(tournament, 'find_matches', {});

    expect(summariesMock.mock.calls[0]?.[1]).toEqual([M1]);
    expect(result.rows?.map((row) => row['Match'])).toEqual(['LSW-P4-M01']);
  });

  it('by its stored label when the codes cannot be read, rather than no answer', async () => {
    summariesMock.mockRejectedValue(new Error('pools: down'));
    const service = new TournamentQueryToolsService(mockSupabase as never, poolStandings as never);

    const result = await service.execute(tournament, 'find_matches', {});

    expect(result.rows?.map((row) => row['Match'])).toEqual(['L1-PD-M01']);
  });
});
