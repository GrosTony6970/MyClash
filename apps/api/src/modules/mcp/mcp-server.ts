import { Logger } from '@nestjs/common';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import type { EventAuthzDeps } from '../../common/auth/event-authz';
import type { EventsService } from '../events/events.service';
import type { FightersService } from '../fighters/fighters.service';
import type { MeEventsService } from '../me/me-events.service';
import type { PublicScheduleService } from '../persons/public-schedule.service';
import type { PoolStandingsService } from '../pool-standings/pool-standings.service';
import type { ScheduleGridService } from '../schedule/schedule-grid.service';
import type { TournamentQueryToolsService } from '../tournament-query/tournament-query.tools.service';
import { eventInfo } from './tools/event-info';
import { eventSchedule } from './tools/event-schedule';
import { registerOrganiserTools } from './tools/tournament-query';
import { tournamentStandings } from './tools/tournament-standings';
import { myEvents } from './tools/my-events';
import { myFightHistory } from './tools/my-fight-history';
import { mySchedule } from './tools/my-schedule';
import { myStats } from './tools/my-stats';
import { myUpcoming } from './tools/my-upcoming';
import { myWorkshops } from './tools/my-workshops';
import { whoami } from './tools/whoami';

/** The person a connector token names, as McpDoorGuard verified it. */
export interface McpCaller {
  userId: string;
  email: string | null;
  /** The OAuth client the token was issued to. */
  clientId: string;
}

/** The services the tools read. */
export interface McpToolDeps extends EventAuthzDeps {
  meEvents: MeEventsService;
  fighters: FightersService;
  schedule: PublicScheduleService;
  events: EventsService;
  scheduleGrid: ScheduleGridService;
  poolStandings: PoolStandingsService;
  queryTools: TournamentQueryToolsService;
}

/** The version of the tool set Claude sees in `serverInfo`. Raise it when a tool changes. */
const MCP_SERVER_VERSION = '1.0.0';

const logger = new Logger('McpServer');

/**
 * The answer of a tool that failed. The SDK would send the error's own message, which can be a
 * database's; this one says nothing about the cause, and the cause goes to the log.
 */
function failed(tool: string, error: unknown): CallToolResult {
  logger.error(
    `mcp tool ${tool} failed: ${error instanceof Error ? error.message : String(error)}`,
  );
  return {
    isError: true,
    content: [{ type: 'text', text: 'MyClash could not answer this. Try again later.' }],
  };
}

/** The answer of a tool that refuses with one plain sentence: a tool error result, never a throw. */
function toolRefusal(text: string): CallToolResult {
  return { isError: true, content: [{ type: 'text', text }] };
}

/**
 * What a tool returns to refuse: one plain sentence. A result is a refusal when it is an object
 * whose only key is a string `refusal`; every real answer has other keys, so none is mistaken
 * for one.
 */
export interface McpRefusal {
  refusal: string;
}

export function isRefusal(result: unknown): result is McpRefusal {
  if (typeof result !== 'object' || result === null) return false;
  const keys = Object.keys(result);
  return (
    keys.length === 1 && keys[0] === 'refusal' && typeof (result as McpRefusal).refusal === 'string'
  );
}

/** The one owner of a tool's answer: JSON text, a refusal as an error result, a throw scrubbed. */
export async function answer(tool: string, run: () => Promise<unknown>): Promise<CallToolResult> {
  try {
    const result = await run();
    if (isRefusal(result)) return toolRefusal(result.refusal);
    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  } catch (error) {
    return failed(tool, error);
  }
}

/**
 * One MCP server for one request (the door is stateless), with the caller already fixed: no tool
 * takes a person from the model.
 */
export function buildMcpServer(caller: McpCaller, deps: McpToolDeps): McpServer {
  const server = new McpServer({ name: 'myclash', version: MCP_SERVER_VERSION });
  server.registerTool(
    'whoami',
    {
      description:
        'The MyClash account this connector is signed in as, and the Events where the person ' +
        'fights, referees, teaches or attends a Workshop.',
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    () => answer('whoami', () => whoami(caller, deps)),
  );
  registerMyTools(server, caller, deps);
  registerMyRecordTools(server, caller, deps);
  registerEventTools(server, caller, deps);
  registerOrganiserTools(server, caller, deps);
  return server;
}

/**
 * The cap of `my_upcoming`. The schema owns it: the SDK refuses a value outside it before the tool
 * runs, so the tool function only applies the default.
 */
const upcomingLimit = z.number().int().min(1).max(50).optional();

/** The cap of `my_fight_history`: the career keeps its newest ten bouts, so ten is all there is. */
const fightHistoryLimit = z.number().int().min(1).max(10).optional();

function registerMyTools(server: McpServer, caller: McpCaller, deps: McpToolDeps): void {
  server.registerTool(
    'my_events',
    {
      description:
        'The Events the signed-in person is part of, with their roles, Tournaments, referee ' +
        'duties and the Workshops they teach.',
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    () => answer('my_events', () => myEvents(caller, deps)),
  );
  server.registerTool(
    'my_upcoming',
    {
      description:
        "The signed-in person's next bouts and referee duties, soonest first. " +
        '`limit` is 1 to 50 (default 20).',
      inputSchema: { limit: upcomingLimit },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ limit }) => answer('my_upcoming', () => myUpcoming(caller, deps, limit)),
  );
  server.registerTool(
    'my_schedule',
    {
      description:
        "The signed-in person's own bouts, referee duties and Workshops at one Event, named by " +
        'its slug (`event`, from my_events). Times are UTC ISO; `event.timezone` is the ' +
        "Event's own zone. Refuses an Event the person is not on the roster of.",
      inputSchema: { event: z.string().min(1).max(200) },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ event }) => answer('my_schedule', () => mySchedule(event, caller, deps)),
  );
}

/** The fighter, referee and Workshop reads of the personal space. */
function registerMyRecordTools(server: McpServer, caller: McpCaller, deps: McpToolDeps): void {
  server.registerTool(
    'my_stats',
    {
      description:
        "The signed-in person's fighter and referee numbers: bouts, wins, losses, draws, per " +
        'weapon, current streak, referee totals and HEMA Ratings. Refuses an account with no ' +
        'fighter profile.',
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    () => answer('my_stats', () => myStats(caller, deps)),
  );
  server.registerTool(
    'my_fight_history',
    {
      description:
        "The signed-in person's newest completed bouts, with the Event, Tournament, result and " +
        'score. `limit` is 1 to 10 (default 10). Refuses an account with no fighter profile.',
      inputSchema: { limit: fightHistoryLimit },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ limit }) => answer('my_fight_history', () => myFightHistory(caller, deps, limit)),
  );
  server.registerTool(
    'my_workshops',
    {
      description:
        'The Workshops the signed-in person teaches (with session counts) and the ones they ' +
        'attend, by name, time and place.',
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    () => answer('my_workshops', () => myWorkshops(caller, deps)),
  );
}

/** The cap of `event_schedule`; the schema owns it, as for `my_upcoming`. */
const scheduleLimit = z.number().int().min(1).max(50).optional();

/** An Event or Tournament named by its slug, the handle `my_events` gives. */
export const slug = z.string().min(1).max(200);

/** What the public Event pages show anyone allowed to see the Event, by slug. */
function registerEventTools(server: McpServer, caller: McpCaller, deps: McpToolDeps): void {
  server.registerTool(
    'event_info',
    {
      description:
        "An Event's dates, place, status and the Tournaments the person can see, named by the " +
        "Event's slug (`event`, from my_events). Times are UTC ISO; `timezone` is the Event's " +
        'own zone.',
      inputSchema: { event: slug },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ event }) => answer('event_info', () => eventInfo(event, caller, deps)),
  );
  server.registerTool(
    'tournament_standings',
    {
      description:
        "A Tournament's pool tables (rank, fighter, club, the ruleset's numbers) and bracket " +
        'rounds, named by the Event slug (`event`) and the Tournament slug (`tournament`, from ' +
        'event_info). A Swiss Tournament lists no round standings: only `swiss`, that it runs ' +
        'Swiss and how many rounds are done. Refuses a Tournament the person cannot see.',
      inputSchema: { event: slug, tournament: slug },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ event, tournament }) =>
      answer('tournament_standings', () => tournamentStandings(event, tournament, caller, deps)),
  );
  registerEventScheduleTool(server, caller, deps);
}

/** The Event's bouts, filtered and capped: a busy Event has hundreds. */
function registerEventScheduleTool(server: McpServer, caller: McpCaller, deps: McpToolDeps): void {
  server.registerTool(
    'event_schedule',
    {
      description:
        "An Event's public bouts, soonest first, with piste (lice), Tournament, round and " +
        "fighters. Times are UTC ISO; `timezone` is the Event's own zone. Filter by " +
        "`tournament` (slug) and/or `day` (YYYY-MM-DD, the Event's own day); bouts " +
        'with no start time come last and match no `day`. `limit` is 1 to 50 (default 20); ' +
        '`total` counts the bouts before the cap.',
      inputSchema: {
        event: slug,
        tournament: slug.optional(),
        day: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional(),
        limit: scheduleLimit,
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ event, ...filters }) =>
      answer('event_schedule', () => eventSchedule(event, filters, caller, deps)),
  );
}
