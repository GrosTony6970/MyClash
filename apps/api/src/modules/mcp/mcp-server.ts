import { Logger } from '@nestjs/common';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { MeEventsService } from '../me/me-events.service';
import { whoami } from './tools/whoami';

/** The person a connector token names, as McpDoorGuard verified it. */
export interface McpCaller {
  userId: string;
  email: string | null;
  /** The OAuth client the token was issued to. */
  clientId: string;
}

/** The services the tools read. */
export interface McpToolDeps {
  meEvents: MeEventsService;
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
  return server;
}
