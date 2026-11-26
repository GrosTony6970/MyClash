import { Logger } from '@nestjs/common';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import type { EventAuthzDeps } from '../../common/auth/event-authz';
import type { MeEventsService } from '../me/me-events.service';
import type { PublicScheduleService } from '../persons/public-schedule.service';
import { myEvents } from './tools/my-events';
import { mySchedule } from './tools/my-schedule';
import { myUpcoming } from './tools/my-upcoming';
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
  schedule: PublicScheduleService;
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
export function toolRefusal(text: string): CallToolResult {
  return { isError: true, content: [{ type: 'text', text }] };
}

async function answer(tool: string, run: () => Promise<unknown>): Promise<CallToolResult> {
  try {
    return { content: [{ type: 'text', text: JSON.stringify(await run()) }] };
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
  return server;
}

/**
 * The cap of `my_upcoming`. The schema owns it: the SDK refuses a value outside it before the tool
 * runs, so the tool function only applies the default.
 */
const upcomingLimit = z.number().int().min(1).max(50).optional();

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
        'its slug (`event`, from my_events). Refuses an Event the person is not on the roster of.',
      inputSchema: { event: z.string().min(1).max(200) },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ event }) => answerOrRefuse('my_schedule', () => mySchedule(event, caller, deps)),
  );
}

/** Like `answer`, for a tool that may refuse with one plain sentence. */
async function answerOrRefuse(
  tool: string,
  run: () => Promise<object | { refusal: string }>,
): Promise<CallToolResult> {
  try {
    const result = await run();
    if ('refusal' in result && typeof result.refusal === 'string') {
      return toolRefusal(result.refusal);
    }
    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  } catch (error) {
    return failed(tool, error);
  }
}
