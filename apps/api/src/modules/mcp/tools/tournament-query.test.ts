import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { M1 } from '../../tournament-query/tournament-query.tools.fixtures';
import { QUERY_TOOL_SPECS } from '../../tournament-query/tournament-query.tools';
import { expectNoRawIds } from './no-raw-ids.test-helper';
import {
  assertOrgRole,
  call,
  chains,
  EVENT_ID,
  ORG_ID,
  readOf,
  resetHarness,
  textOf,
  tools,
  world,
  writes,
} from './tournament-query.test-helper';

const summariesMock = vi.hoisted(() => vi.fn());
vi.mock('../../matches/match-summaries', () => ({ matchSummaries: summariesMock }));

const ARGS: Record<string, Record<string, unknown>> = {
  find_fighters: {},
  get_fighter_stats: { fighter: 'Ada Lovelace' },
  find_matches: { pool: 'Pool A' },
  get_ring_status: {},
  rank_fighters: { metric: 'wins', min_matches: 0 },
  get_judge_stats: { judge: 'Jean' },
  compare_clubs: { club_names: ['Alpha', 'Beta'] },
  get_bracket_status: { weapon: 'longsword' },
  get_tournament_summary: {},
  estimate_pool_completion: {},
  get_schedule_status: {},
  find_lagging_pools: { threshold_minutes: 0 },
};

beforeEach(() => {
  resetHarness();
  summariesMock.mockReset().mockResolvedValue(new Map([[M1, { roundCode: 'LSW-P1-M01' }]]));
});

describe('the query panel tools in Claude', () => {
  it('registers every panel tool but get_pool_standings, read-only, from the one table', () => {
    const registered = tools();
    expect([...registered.keys()].sort()).toEqual(Object.keys(ARGS).sort());
    for (const spec of QUERY_TOOL_SPECS.filter((s) => s.name !== 'get_pool_standings')) {
      const tool = registered.get(spec.name)!;
      expect(Object.keys(tool.config.inputSchema)).toEqual([
        'event',
        'tournament',
        ...Object.keys(spec.args),
      ]);
      expect(tool.config.annotations).toEqual({ readOnlyHint: true, openWorldHint: false });
    }
  });

  // The table's bounds reach the schema: the SDK refuses these before the tool runs.
  it.each([
    ['a number past its max', 'find_fighters', { limit: 201 }],
    ['a club list of one club', 'compare_clubs', { club_names: ['Alpha'] }],
    ['an enum value outside it', 'find_fighters', { status: 'retired' }],
    ['a string over 200', 'find_fighters', { club_name: 'x'.repeat(201) }],
    ['a lice that is not a whole number', 'get_ring_status', { ring_number: 1.5 }],
  ])('refuses %s in the input schema', (_what, name, args) => {
    const schema = z.object(tools().get(name)!.config.inputSchema);
    const base = { event: 'fal-2026', tournament: 'longsword' };
    expect(schema.safeParse(base).success).toBe(true);
    expect(schema.safeParse({ ...base, ...args }).success).toBe(false);
  });

  it.each(Object.entries(ARGS))(
    '%s answers an organiser, with no raw id, and writes nothing',
    async (name, args) => {
      const result = await call(name, args);

      expect(result.isError, textOf(result)).toBeUndefined();
      const answer = JSON.parse(textOf(result)) as {
        render_hint: string;
        metadata: { tool_name: string };
      };
      expect(answer.metadata.tool_name).toBe(name);
      // A real answer, not "no results": the fixture has rows for every tool to show.
      expect(answer.render_hint, textOf(result)).not.toBe('empty');
      expectNoRawIds(result);
      expect(assertOrgRole).toHaveBeenCalledWith(ORG_ID, 'user-1', 'admin');
      expect(writes).not.toHaveBeenCalled();
    },
  );

  it('finds the Tournament by its slug at the Event, reading only its id', async () => {
    await call('get_tournament_summary', {});

    const read = readOf('tournaments', 'id');
    expect(read['eq']!.mock.calls).toEqual([
      ['event_id', EVENT_ID],
      ['slug', 'longsword'],
    ]);
    expect(read['maybeSingle']).toHaveBeenCalled();
  });

  it('refuses an unknown Event in the Event refusal', async () => {
    world.event = false;

    const result = await call('find_fighters', {});

    expect(textOf(result)).toBe('No Event "fal-2026" that you can see.');
    expect(assertOrgRole).not.toHaveBeenCalled();
  });

  it('refuses an unknown Tournament in the Tournament refusal', async () => {
    world.tournament = false;

    const result = await call('find_fighters', {});

    expect(textOf(result)).toBe('No Tournament "longsword" at FAL 2026 that you can see.');
    expect(assertOrgRole).not.toHaveBeenCalled();
  });

  it('refuses a call with a missing required argument in the panel check words', async () => {
    const result = await call('get_fighter_stats', {});

    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe('fighter is required');
    expect(chains.some((c) => c.table === 'vw_tournament_query_fighters')).toBe(false);
  });
});
