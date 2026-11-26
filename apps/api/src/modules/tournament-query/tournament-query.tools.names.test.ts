import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TournamentQueryToolsService } from './tournament-query.tools.service';
import { expectNoRawIds } from '../mcp/tools/no-raw-ids.test-helper';
import {
  awaitableChain,
  fighterRows,
  M1,
  M2,
  M3,
  poolBout,
  POOL_B,
  REG_ADA,
  REG_GRACE_H,
  refereeRows,
  tournament,
} from './tournament-query.tools.fixtures';

const summariesMock = vi.hoisted(() => vi.fn());
vi.mock('../matches/match-summaries', () => ({ matchSummaries: summariesMock }));

const fromMock = vi.fn();
const mockSupabase = { service: { from: fromMock } };

describe('TournamentQueryToolsService · a fighter, a pool and a judge by name', () => {
  let service: TournamentQueryToolsService;
  const matchRows = [
    poolBout(M1, REG_ADA, REG_GRACE_H),
    poolBout(M2, REG_GRACE_H, REG_ADA, { pool_id: POOL_B, pool_name: 'Pool B', lice_number: 2 }),
    // No stored label and no code: the Match cell must not fall back to the match id.
    poolBout(M3, REG_ADA, REG_GRACE_H, { status: 'scheduled', match_number_label: null }),
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    summariesMock.mockResolvedValue(new Map());
    service = new TournamentQueryToolsService(mockSupabase as never);
    fromMock.mockImplementation((tableName: string) => {
      const data: Record<string, unknown[]> = {
        vw_tournament_query_fighters: fighterRows,
        vw_tournament_query_matches: matchRows,
        vw_tournament_query_referees: refereeRows,
      };
      return awaitableChain({ data: data[tableName] ?? [], error: null });
    });
  });

  it('get_fighter_stats finds one fighter by a piece of the name', async () => {
    const result = await service.execute(tournament, 'get_fighter_stats', { fighter: 'lovelace' });

    expect(result.render_hint).toBe('card');
    expect(result.title).toBe('Stats for Ada Lovelace');
    expect(result.card).toMatchObject({ Matches: 2, Wins: 1, Losses: 1 });
    expectNoRawIds(result);
  });

  it('get_fighter_stats names the fighters when the text fits two, and gives no stats', async () => {
    const result = await service.execute(tournament, 'get_fighter_stats', { fighter: 'Grace' });

    expect(result.render_hint).toBe('list');
    expect(result.title).toBe('Several fighters match "Grace"');
    expect(result.items).toEqual([
      { label: 'Grace Hopper', value: 'Beta' },
      { label: 'Grace Murray', value: 'registered' },
    ]);
    expect(result.card).toBeUndefined();
    expectNoRawIds(result);
  });

  it('get_fighter_stats says so when no fighter has that name', async () => {
    const result = await service.execute(tournament, 'get_fighter_stats', { fighter: 'Zoe' });

    expect(result.render_hint).toBe('empty');
    expect(result.metadata.notes).toContain('No matches found for this fighter');
  });

  it('get_fighter_stats does not take an id for a name', async () => {
    const result = await service.execute(tournament, 'get_fighter_stats', { fighter: REG_ADA });

    expect(result.render_hint).toBe('empty');
  });

  it('find_matches filters by the fighter name', async () => {
    const result = await service.execute(tournament, 'find_matches', { fighter: 'Ada' });

    expect(result.rows).toHaveLength(3);
    const none = await service.execute(tournament, 'find_matches', { fighter: 'Zoe' });
    expect(none.render_hint).toBe('empty');
    const several = await service.execute(tournament, 'find_matches', { fighter: 'Grace' });
    expect(several.render_hint).toBe('list');
    expect(several.title).toBe('Several fighters match "Grace"');
  });

  it('find_matches filters by the pool name, and shows no id for a bout with no code', async () => {
    const result = await service.execute(tournament, 'find_matches', { pool: 'Pool B' });

    expect(result.rows).toHaveLength(1);
    expect(result.rows?.[0]).toMatchObject({ Pool: 'Pool B', Match: '' });
    expectNoRawIds(result);
  });

  it('estimate_pool_completion filters by the pool name', async () => {
    const result = await service.execute(tournament, 'estimate_pool_completion', {
      pool: 'Pool A',
    });

    expect(result.rows).toHaveLength(1);
    expect(result.rows?.[0]).toMatchObject({ Pool: 'Pool A', Completed: 1, Remaining: 1 });
    expectNoRawIds(result);
  });

  it('get_pool_standings filters by the pool name', async () => {
    const result = await service.execute(tournament, 'get_pool_standings', { pool: 'Pool B' });

    expect(result.rows?.every((row) => row['Pool'] === 'Pool B')).toBe(true);
    expectNoRawIds(result);
  });

  it('shows no raw id in any tool answer', async () => {
    const bracketBout = {
      ...poolBout(M1, REG_ADA, REG_GRACE_H),
      phase_type: 'single_elim',
      pool_id: null,
      pool_name: null,
      bracket_round: 1,
      bracket_position: null,
    };
    fromMock.mockImplementation((tableName: string) => {
      const data: Record<string, unknown[]> = {
        vw_tournament_query_fighters: fighterRows,
        vw_tournament_query_matches: [...matchRows, bracketBout],
        vw_tournament_query_referees: refereeRows,
        vw_tournament_query_exchange_summary: [
          { tournament_id: tournament.tournamentId, match_id: M1, doubles: 1, afterblows: 0 },
        ],
        event_programme_blocks: [
          {
            event_id: tournament.eventId,
            label: 'Pools',
            start_time: '2026-11-26T09:00:00Z',
            end_time: '2026-11-26T12:00:00Z',
          },
        ],
      };
      return awaitableChain({ data: data[tableName] ?? [], error: null });
    });
    const calls: Array<[string, Record<string, unknown>]> = [
      ['find_fighters', {}],
      ['get_fighter_stats', { fighter: 'Ada' }],
      ['find_matches', {}],
      ['get_pool_standings', {}],
      ['get_ring_status', {}],
      ['rank_fighters', { metric: 'wins', min_matches: 0 }],
      ['get_judge_stats', { judge: 'Jean' }],
      ['compare_clubs', { club_names: ['Alpha', 'Beta'] }],
      ['get_bracket_status', { weapon: 'longsword' }],
      ['get_tournament_summary', {}],
      ['estimate_pool_completion', {}],
      ['get_schedule_status', {}],
      ['find_lagging_pools', { threshold_minutes: 0 }],
    ];

    for (const [name, args] of calls) {
      const result = await service.execute(tournament, name, args);
      expect(result.render_hint, name).not.toBe('empty');
      expectNoRawIds(result);
    }
    const bracket = await service.execute(tournament, 'get_bracket_status', {});
    expect(bracket.rows?.[0]?.['Match']).toBe('');
  });
});
