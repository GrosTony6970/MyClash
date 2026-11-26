import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { vi } from 'vitest';
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
import { registerOrganiserTools } from './tournament-query';

// The harness of the organiser tools' tests: the real tools service over a recording Supabase
// mock, UUID ids in every row, and the registered tools called as the SDK calls them.

const caller = { userId: 'user-1', email: 'a@b.c', clientId: 'c' };
export const EVENT_ID = fixture.eventId;
export const TOURNAMENT_ID = fixture.tournamentId;
export const ORG_ID = fixture.organizationId;

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

/** What the world holds for one test; `resetHarness` sets it back. */
export const world = {
  event: true,
  tournament: true,
  tournamentStatus: 'running',
  policy: 'organizers_only',
  referee: false,
};

/** The projection of the public Tournament gate (`canReadTournament`). */
export const VISIBILITY_SELECT = 'status, events!inner(id, status, organization_id, event_kind)';

function single(table: string, select: string | undefined): unknown {
  switch (table) {
    case 'events':
      return world.event ? eventRow : null;
    case 'tournaments':
      if (select === 'id') return world.tournament ? { id: TOURNAMENT_ID } : null;
      if (select === VISIBILITY_SELECT) {
        return {
          status: world.tournamentStatus,
          events: {
            id: EVENT_ID,
            status: 'published',
            organization_id: ORG_ID,
            event_kind: 'real',
          },
        };
      }
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
/** Every read the call made, in order. */
export const chains: { table: string; chain: Chain }[] = [];
/** Called once per insert, upsert, update or delete, on any table. */
export const writes = vi.fn();
export const assertOrgRole = vi.fn();

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

/** The first read of `table` whose projection is `select`. */
export function readOf(table: string, select: string): Chain {
  return chains.find((c) => c.table === table && c.chain['select']!.mock.calls[0]?.[0] === select)!
    .chain;
}

export function resetHarness(): void {
  Object.assign(world, {
    event: true,
    tournament: true,
    tournamentStatus: 'running',
    policy: 'organizers_only',
    referee: false,
  });
  chains.length = 0;
  writes.mockReset();
  assertOrgRole.mockReset().mockResolvedValue('admin');
}

type Registered = {
  config: { inputSchema: Record<string, z.ZodType>; annotations: object };
  run: (input: Record<string, unknown>) => Promise<CallToolResult>;
};

export function tools(): Map<string, Registered> {
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
export async function call(name: string, args: Record<string, unknown>) {
  const tool = tools().get(name)!;
  const input = z.object(tool.config.inputSchema).parse({
    event: 'fal-2026',
    tournament: 'longsword',
    ...args,
  });
  return tool.run(input);
}

export function textOf(result: CallToolResult): string {
  return (result.content[0] as { text: string }).text;
}
