import { ForbiddenException } from '@nestjs/common';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { TournamentQueryToolsService } from '../../tournament-query/tournament-query.tools.service';
import {
  fighterRows,
  GP_JEAN,
  M1,
  M2,
  M3,
  poolBout,
  REG_ADA,
  REG_GRACE_H,
  REG_GRACE_M,
  refereeRows,
  tournament as fixture,
  uuid,
} from '../../tournament-query/tournament-query.tools.fixtures';
import { QUERY_TOOL_SPECS } from '../../tournament-query/tournament-query.tools';
import { expectNoRawIds } from './no-raw-ids.test-helper';
import { registerOrganiserTools } from './tournament-query';

const summariesMock = vi.hoisted(() => vi.fn());
vi.mock('../../matches/match-summaries', () => ({ matchSummaries: summariesMock }));

const caller = { userId: 'user-1', email: 'a@b.c', clientId: 'c' };
const EVENT_ID = fixture.eventId;
const TOURNAMENT_ID = fixture.tournamentId;
const ORG_ID = fixture.organizationId;

const eventRow = {
  id: EVENT_ID,
  name: 'FAL 2026',
  slug: 'fal-2026',
  start_date: '2026-03-14',
  end_date: '2026-03-15',
  status: 'published',
  timezone: 'Europe/Paris',
  city: 'Lyon',
  country: 'FR',
  organization_id: ORG_ID,
  event_kind: 'real',
};

const bouts = [
  poolBout(M1, REG_ADA, REG_GRACE_H, {
    event_id: EVENT_ID,
    lice_id: uuid(61),
    duration_active_ms: 120000,
  }),
  poolBout(M2, REG_GRACE_H, REG_ADA, {
    event_id: EVENT_ID,
    lice_id: uuid(61),
    status: 'scheduled',
    winner_registration_id: null,
    scheduled_at: '2026-03-14T10:00:00Z',
  }),
  {
    tournament_id: TOURNAMENT_ID,
    event_id: EVENT_ID,
    match_id: M3,
    phase_type: 'single_elim',
    bracket_round: 1,
    bracket_position: 0,
    red_registration_id: REG_ADA,
    blue_registration_id: REG_GRACE_M,
    red_name: 'Ada Lovelace',
    blue_name: 'Grace Murray',
    winner_registration_id: REG_ADA,
    red_score: 5,
    blue_score: 2,
    status: 'completed',
  },
];

/** What the world holds for one test. */
let world: { event: boolean; tournament: boolean; policy: string; referee: boolean };

function single(table: string, select: string | undefined): unknown {
  switch (table) {
    case 'events':
      return world.event ? eventRow : null;
    case 'tournaments':
      if (select === 'id') return world.tournament ? { id: TOURNAMENT_ID } : null;
      return {
        id: TOURNAMENT_ID,
        event_id: EVENT_ID,
        name: 'Longsword Open',
        weapon: 'longsword',
        events: { organization_id: ORG_ID },
      };
    case 'tournament_query_settings':
      return { access_policy: world.policy, rate_limit_per_hour: 60 };
    case 'global_persons':
      return world.referee ? { id: GP_JEAN } : null;
    case 'event_referees':
      return world.referee ? { person_id: GP_JEAN } : null;
    default:
      return null;
  }
}

const lists: Record<string, unknown[]> = {
  tournaments: [{ weapon: 'longsword' }],
  vw_tournament_query_pools: [{ pool_name: 'Pool A' }],
  lices: [{ sort_order: 0 }],
  vw_tournament_query_fighters: fighterRows.map((row) => ({
    ...row,
    tournament_id: TOURNAMENT_ID,
    event_id: EVENT_ID,
    weapon: 'longsword',
  })),
  vw_tournament_query_matches: bouts,
  vw_tournament_query_exchange_summary: [
    { tournament_id: TOURNAMENT_ID, match_id: M1, doubles: 1, afterblows: 1 },
  ],
  vw_tournament_query_referees: refereeRows,
  event_programme_blocks: [
    {
      event_id: EVENT_ID,
      competition_id: TOURNAMENT_ID,
      competition_phase: 'pools',
      label: 'Longsword pools',
      start_time: '2026-03-14T09:00:00Z',
      end_time: '2026-03-14T12:00:00Z',
    },
  ],
};

type Chain = Record<string, ReturnType<typeof vi.fn>> & PromiseLike<unknown>;
let chains: { table: string; chain: Chain }[];
const writes = vi.fn();

function from(table: string): Chain {
  const chain = {} as Chain;
  for (const key of ['select', 'eq', 'in', 'or', 'order', 'limit']) {
    chain[key] = vi.fn().mockReturnValue(chain);
  }
  for (const key of ['insert', 'upsert', 'update', 'delete']) {
    chain[key] = vi.fn(() => {
      writes(table, key);
      return chain;
    });
  }
  chain['maybeSingle'] = vi.fn(() =>
    Promise.resolve({ data: single(table, chain['select']!.mock.calls.at(-1)?.[0]), error: null }),
  );
  (chain as { then: PromiseLike<unknown>['then'] }).then = (resolve, reject) =>
    Promise.resolve({ data: lists[table] ?? [], error: null }).then(resolve, reject);
  chains.push({ table, chain });
  return chain;
}

const assertOrgRole = vi.fn();

type Registered = {
  config: { inputSchema: Record<string, z.ZodType>; annotations: object };
  run: (input: Record<string, unknown>) => Promise<CallToolResult>;
};

function tools(): Map<string, Registered> {
  const supabase = { service: { from } };
  const deps = {
    supabase,
    orgs: { assertOrgRole },
    queryTools: new TournamentQueryToolsService(supabase as never, {} as never),
  } as never;
  const registered = new Map<string, Registered>();
  const server = {
    registerTool: (name: string, config: Registered['config'], run: Registered['run']) =>
      registered.set(name, { config, run }),
  };
  registerOrganiserTools(server as never, caller, deps);
  return registered;
}

/** A call as the SDK makes it: the input parsed by the tool's own schema first. */
async function call(name: string, args: Record<string, unknown>) {
  const tool = tools().get(name)!;
  const input = z.object(tool.config.inputSchema).parse({
    event: 'fal-2026',
    tournament: 'longsword',
    ...args,
  });
  return tool.run(input);
}

function textOf(result: CallToolResult): string {
  return (result.content[0] as { text: string }).text;
}

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
  world = { event: true, tournament: true, policy: 'organizers_only', referee: false };
  chains = [];
  writes.mockReset();
  assertOrgRole.mockReset().mockResolvedValue('admin');
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

    const read = chains.find(
      (c) => c.table === 'tournaments' && c.chain['select']!.mock.calls[0]?.[0] === 'id',
    )!.chain;
    expect(read['eq']!.mock.calls).toEqual([
      ['event_id', EVENT_ID],
      ['slug', 'longsword'],
    ]);
    expect(read['maybeSingle']).toHaveBeenCalled();
  });

  it('refuses a stranger under organizers_only, naming who the organiser lets ask', async () => {
    assertOrgRole.mockRejectedValue(new ForbiddenException('not a member'));

    const result = await call('get_tournament_summary', {});

    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe(
      'The organiser of Longsword Open lets organisers ask about it, and you are not one of them.',
    );
    expect(chains.some((c) => c.table.startsWith('vw_tournament_query_'))).toBe(false);
  });

  it("names the Event's referees and the roster under the widest setting", async () => {
    world.policy = 'anyone_with_tournament_access';
    assertOrgRole.mockRejectedValue(new ForbiddenException('not a member'));

    const result = await call('get_tournament_summary', {});

    expect(textOf(result)).toBe(
      "The organiser of Longsword Open lets organisers, the Event's referees and the people on " +
        'its roster ask about it, and you are not one of them.',
    );
  });

  it('lets an Event referee in under organizers_head_judges', async () => {
    world.policy = 'organizers_head_judges';
    world.referee = true;
    assertOrgRole.mockRejectedValue(new ForbiddenException('not a member'));

    const result = await call('get_tournament_summary', {});

    expect(result.isError).toBeUndefined();
    expect(JSON.parse(textOf(result))).toMatchObject({ title: 'Tournament summary' });
  });

  it('refuses an Event referee under organizers_only', async () => {
    world.referee = true;
    assertOrgRole.mockRejectedValue(new ForbiddenException('not a member'));

    const result = await call('get_tournament_summary', {});

    expect(textOf(result)).toBe(
      'The organiser of Longsword Open lets organisers ask about it, and you are not one of them.',
    );
  });

  it('answers a failed membership read as a failure, not a refusal', async () => {
    assertOrgRole.mockRejectedValue(new Error('membership read failed: connection reset'));

    const result = await call('get_tournament_summary', {});

    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe('MyClash could not answer this. Try again later.');
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
