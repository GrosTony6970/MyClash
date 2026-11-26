import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TournamentQueryToolsService } from './tournament-query.tools.service';
import { expectNoRawIds } from '../mcp/tools/no-raw-ids.test-helper';
import { poolTables, REG_LONELY, tournament } from './tournament-query.tools.fixtures';

// The panel reads the public Tournament page's pool tables; it counts nothing itself, so the
// database double is never asked for a match.
const fromMock = vi.fn();
const poolStandings = { getPoolStandings: vi.fn() };

describe('TournamentQueryToolsService · get_pool_standings reads the public pool tables', () => {
  let service: TournamentQueryToolsService;

  beforeEach(() => {
    vi.clearAllMocks();
    poolStandings.getPoolStandings.mockResolvedValue(poolTables());
    service = new TournamentQueryToolsService(
      { service: { from: fromMock } } as never,
      poolStandings as never,
    );
  });

  it('reads the by-pool table of this Tournament and touches no match', async () => {
    await service.execute(tournament, 'get_pool_standings', {});

    expect(poolStandings.getPoolStandings).toHaveBeenCalledWith(tournament.tournamentId, 'by-pool');
    expect(fromMock).not.toHaveBeenCalled();
  });

  it('keeps the ruleset rank order, not wins then points', async () => {
    const result = await service.execute(tournament, 'get_pool_standings', {});

    // Grace has one win and Ada two, yet the ruleset ranks Grace first.
    expect(result.rows?.filter((r) => r['Pool'] === 'Pool A').map((r) => r['Fighter'])).toEqual([
      'Grace Hopper',
      'Ada Lovelace',
    ]);
    expect(result.rows?.[0]).toEqual({
      Rank: 1,
      Pool: 'Pool A',
      Fighter: 'Grace Hopper',
      Club: 'ALP',
      Wins: 1,
      Score: 9,
    });
  });

  it('heads the table with the ruleset columns, in their order', async () => {
    const result = await service.execute(tournament, 'get_pool_standings', {});

    expect(result.title).toBe('Pool standings');
    expect(result.columns).toEqual(['Rank', 'Pool', 'Fighter', 'Club', 'Wins', 'Score']);
    expect(result.metadata.tool_name).toBe('get_pool_standings');
  });

  it('keeps only the pool whose name is asked for', async () => {
    const result = await service.execute(tournament, 'get_pool_standings', { pool: 'Pool B' });

    expect(result.rows?.map((r) => r['Pool'])).toEqual(['Pool B']);
  });

  it('says "Unknown fighter" for a nameless one, with a blank club', async () => {
    const result = await service.execute(tournament, 'get_pool_standings', { pool: 'Pool B' });

    expect(result.rows?.[0]).toMatchObject({ Fighter: 'Unknown fighter', Club: '' });
    expect(JSON.stringify(result)).not.toContain(REG_LONELY);
  });

  it('shows no raw id although the tables carry pool and registration ids', async () => {
    expectNoRawIds(await service.execute(tournament, 'get_pool_standings', {}));
  });

  it('is empty for a pool that does not exist', async () => {
    const result = await service.execute(tournament, 'get_pool_standings', { pool: 'Pool Z' });

    expect(result.render_hint).toBe('empty');
    expect(result.metadata.notes).toEqual(['No pool matches found']);
  });

  it('is empty when the Tournament has no pool tables', async () => {
    poolStandings.getPoolStandings.mockResolvedValue({ ...poolTables(), pools: [] });
    const none = await service.execute(tournament, 'get_pool_standings', {});
    poolStandings.getPoolStandings.mockResolvedValue({ columns: [], rows: [] });
    const single = await service.execute(tournament, 'get_pool_standings', {});

    expect(none.render_hint).toBe('empty');
    expect(single.render_hint).toBe('empty');
  });
});
