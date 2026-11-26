import { ForbiddenException } from '@nestjs/common';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { canReadTournament } from '../../../common/auth/competition-visibility';
import { QUERY_ACCESS_POLICIES } from '../../tournament-query/dto/tournament-query.dto';
import {
  assertQueryAccess,
  queryTournamentContext,
  readQuerySettings,
} from '../../tournament-query/tournament-query.access';
import {
  QUERY_TOOL_SPECS,
  validateToolCall,
  type QueryToolArgSpec,
  type QueryToolSpec,
} from '../../tournament-query/tournament-query.tools';
import type { ToolResult, TournamentContext } from '../../tournament-query/tournament-query.types';
import { answer, slug, type McpCaller, type McpRefusal, type McpToolDeps } from '../mcp-server';
import { noEventRefusal, noTournamentRefusal, readableEventBySlug } from './readable-event';

/**
 * `get_pool_standings` stays in the panel only: `tournament_standings` already answers it from the
 * same pool-standings table (call C9).
 */
const NOT_IN_CLAUDE = new Set(['get_pool_standings']);

type QueryAccessPolicy = (typeof QUERY_ACCESS_POLICIES)[number];

/** Who each access setting lets ask, in the refusal's words. A new setting must be worded here. */
const WHO_MAY_ASK: Record<QueryAccessPolicy, string> = {
  organizers_only: 'organisers',
  organizers_head_judges: "organisers and the Event's referees",
  anyone_with_tournament_access:
    "organisers, the Event's referees and the people on the Event's roster",
};

/** A setting outside the one list is a broken row, not a refusal: it throws (a failure). */
function whoMayAsk(policy: string): string {
  if (!(QUERY_ACCESS_POLICIES as readonly string[]).includes(policy)) {
    throw new Error(`unknown query access policy: ${policy}`);
  }
  return WHO_MAY_ASK[policy as QueryAccessPolicy];
}

const text = z.string().max(200);

/** One argument of the panel's table as zod: the table is the one list (call C10). */
function argInput(spec: QueryToolArgSpec): z.ZodType {
  const field = argField(spec);
  return spec.required ? field : field.optional();
}

function argField(spec: QueryToolArgSpec): z.ZodType {
  switch (spec.kind) {
    case 'string':
    case 'weapon':
    case 'pool':
    case 'division':
      return text;
    case 'number':
      return z.number().min(spec.min).max(spec.max);
    case 'enum':
      return z.enum(spec.values as [string, ...string[]]);
    case 'lice':
      return z.number().int();
    case 'club_list':
      return z.array(text).min(spec.min).max(spec.max);
  }
}

function inputOf(spec: QueryToolSpec): Record<string, z.ZodType> {
  const args = Object.entries(spec.args).map(([name, arg]) => [name, argInput(arg)] as const);
  return { event: slug, tournament: slug, ...Object.fromEntries(args) };
}

/**
 * The id of the Tournament a call names, or the refusal for it. The Event goes through the public
 * Event gate (call C11), then the Tournament through the public Tournament gate, before any
 * setting is read: a hidden (draft) Tournament is unknown to a non-insider, whatever the setting
 * admits, and its name is not said.
 */
async function readableTournamentId(
  eventSlug: string,
  tournamentSlug: string,
  caller: McpCaller,
  deps: McpToolDeps,
): Promise<string | McpRefusal> {
  const event = await readableEventBySlug(eventSlug, caller, deps);
  if (!event) return noEventRefusal(eventSlug);

  const { data, error } = await deps.supabase.service
    .from('tournaments')
    .select('id')
    .eq('event_id', event.id)
    .eq('slug', tournamentSlug)
    .maybeSingle();
  if (error) throw new Error(`tournament read failed: ${error.message}`);
  if (!data) return noTournamentRefusal(tournamentSlug, event);
  const tournamentId = (data as { id: string }).id;
  const reader = { userId: caller.userId, staff: null };
  if (!(await canReadTournament(deps, tournamentId, reader))) {
    return noTournamentRefusal(tournamentSlug, event);
  }
  return tournamentId;
}

/**
 * The refusal of a caller the Tournament's setting does not admit, or null. Only a
 * ForbiddenException is a refusal (call C12); any other throw is a failed read, and `answer()`
 * turns it into the generic failure. An UnauthorizedException cannot come here (a door caller
 * always has a user id), and if it did, it would be a failure too.
 */
async function accessRefusal(
  tournament: TournamentContext,
  settings: { accessPolicy: string },
  caller: McpCaller,
  deps: McpToolDeps,
): Promise<McpRefusal | null> {
  try {
    await assertQueryAccess(
      { supabase: deps.supabase, organizations: deps.orgs },
      tournament,
      caller.userId,
      settings,
    );
    return null;
  } catch (refused) {
    if (!(refused instanceof ForbiddenException)) throw refused;
    const who = whoMayAsk(settings.accessPolicy);
    return {
      refusal: `The organiser of ${tournament.name} lets ${who} ask about it, and you are not one of them.`,
    };
  }
}

/**
 * One panel tool for one Tournament, under the Tournament's own access setting. It writes
 * nothing (ruling 985): no history row, no AI key check, no per-hour limit (spec call D).
 */
async function queryTool(
  name: string,
  input: Record<string, unknown>,
  caller: McpCaller,
  deps: McpToolDeps,
): Promise<ToolResult | McpRefusal> {
  const {
    event,
    tournament: tournamentSlug,
    ...args
  } = input as {
    event: string;
    tournament: string;
  } & Record<string, unknown>;
  const tournamentId = await readableTournamentId(event, tournamentSlug, caller, deps);
  if (typeof tournamentId !== 'string') return tournamentId;

  const [tournament, settings] = await Promise.all([
    queryTournamentContext(deps.supabase, tournamentId),
    readQuerySettings(deps.supabase, tournamentId),
  ]);
  const refusal = await accessRefusal(tournament, settings, caller, deps);
  if (refusal) return refusal;

  const toolContext = await deps.queryTools.getToolContext(tournament);
  const validation = validateToolCall({ name, arguments: args }, toolContext);
  // validateToolCall words every refusal it makes.
  if (!validation.ok) return { refusal: validation.message! };
  return deps.queryTools.execute(tournament, name, args);
}

/**
 * The in-app query panel's tools, for one Tournament named by its Event's slug and its own. Same
 * names, descriptions and arguments as the panel, from its one table.
 */
export function registerOrganiserTools(
  server: McpServer,
  caller: McpCaller,
  deps: McpToolDeps,
): void {
  for (const spec of QUERY_TOOL_SPECS.filter((s) => !NOT_IN_CLAUDE.has(s.name))) {
    server.registerTool(
      spec.name,
      {
        description:
          `${spec.description} For one Tournament, named by the Event slug (\`event\`, from ` +
          'my_events) and the Tournament slug (`tournament`, from event_info). The ' +
          "Tournament's organiser decides who may ask.",
        inputSchema: inputOf(spec),
        annotations: { readOnlyHint: true, openWorldHint: false },
      },
      (input) => answer(spec.name, () => queryTool(spec.name, input, caller, deps)),
    );
  }
}
