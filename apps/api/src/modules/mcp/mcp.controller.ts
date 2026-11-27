import {
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { ConfigService } from '@nestjs/config';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { EventsService } from '../events/events.service';
import { FightersService } from '../fighters/fighters.service';
import { MatchesService } from '../matches/matches.service';
import { MeEventsService } from '../me/me-events.service';
import { PublicScheduleService } from '../persons/public-schedule.service';
import { OrganizationsService } from '../organizations/organizations.service';
import { OrganizerAIAssistantService } from '../organizer-ai-assistant/organizer-ai-assistant.service';
import { PoolStandingsService } from '../pool-standings/pool-standings.service';
import { AssignmentBoardService } from '../referees/assignment-board.service';
import { QualificationsService } from '../referees/qualifications.service';
import { ScheduleGridService } from '../schedule/schedule-grid.service';
import { SupabaseService } from '../supabase/supabase.service';
import { TournamentQueryToolsService } from '../tournament-query/tournament-query.tools.service';
import { McpDoor } from './mcp-door.decorator';
import { mcpCallerOf } from './mcp-door.guard';
import { buildMcpServer, type McpToolDeps } from './mcp-server';
import { confirmationKey } from './tools/write-confirmation';

/** JSON-RPC's own "internal error", for a request the door could not finish. */
export const MCP_INTERNAL_ERROR = JSON.stringify({
  jsonrpc: '2.0',
  error: { code: -32603, message: 'Internal error' },
  id: null,
});

/**
 * The MCP endpoint Claude's connector calls: `POST /api/v1/mcp`, Streamable HTTP, stateless.
 *
 * Each POST builds its own server and transport and closes both once the answer is sent: no
 * session is kept, so no session id is ever issued and a client never sends the DELETE that ends
 * one. A GET would open a stream for the server's own messages, and a stateless server sends none,
 * so it answers 405.
 */
@ApiTags('mcp')
@McpDoor()
@Controller('mcp')
export class McpController {
  private readonly logger = new Logger(McpController.name);
  private readonly confirmKey: Buffer | null;
  private readonly domain: string | null;

  constructor(
    private readonly meEvents: MeEventsService,
    private readonly supabase: SupabaseService,
    private readonly orgs: OrganizationsService,
    private readonly schedule: PublicScheduleService,
    private readonly fighters: FightersService,
    private readonly events: EventsService,
    private readonly scheduleGrid: ScheduleGridService,
    private readonly poolStandings: PoolStandingsService,
    private readonly queryTools: TournamentQueryToolsService,
    private readonly matches: MatchesService,
    private readonly refereeBoard: AssignmentBoardService,
    private readonly qualifications: QualificationsService,
    private readonly assistant: OrganizerAIAssistantService,
    config: ConfigService,
  ) {
    // Derived once: the tools never read the environment. No secret, no key: a write preview
    // then fails rather than hand out a token apply could not check.
    const secret = config.get<string>('SUPABASE_JWT_SECRET');
    this.confirmKey = secret ? confirmationKey(secret) : null;
    // No DOMAIN, no draft link: a draft tool then fails before it saves.
    this.domain = config.get<string>('DOMAIN') ?? null;
  }

  @Post()
  @ApiOperation({
    summary: 'MCP Streamable HTTP endpoint (JSON-RPC); a Claude connector token as Bearer only',
  })
  async handle(@Req() req: FastifyRequest, @Res() reply: FastifyReply): Promise<void> {
    const caller = mcpCallerOf(req);
    // The transport writes the answer on the raw response; Fastify must not send one too. From
    // here on Nest's exception filter cannot answer, so this method answers its own failure.
    reply.hijack();
    let server: McpServer | undefined;
    let transport: StreamableHTTPServerTransport | undefined;
    try {
      server = buildMcpServer(caller, this.toolDeps());
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });
      await server.connect(transport);
      await transport.handleRequest(req.raw, reply.raw, req.body);
    } catch (error) {
      // The cause only: never the body nor the token.
      this.logger.error(
        `mcp request failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      if (!reply.raw.headersSent) {
        reply.raw.writeHead(HttpStatus.INTERNAL_SERVER_ERROR, {
          'content-type': 'application/json',
        });
        reply.raw.end(MCP_INTERNAL_ERROR);
      } else if (!reply.raw.writableEnded) {
        reply.raw.end();
      }
    } finally {
      await Promise.allSettled([transport?.close(), server?.close()]);
    }
  }

  /** The services and the settings the tools are given: they read no environment themselves. */
  private toolDeps(): McpToolDeps {
    return {
      meEvents: this.meEvents,
      supabase: this.supabase,
      orgs: this.orgs,
      schedule: this.schedule,
      fighters: this.fighters,
      events: this.events,
      scheduleGrid: this.scheduleGrid,
      poolStandings: this.poolStandings,
      queryTools: this.queryTools,
      matches: this.matches,
      refereeBoard: this.refereeBoard,
      qualifications: this.qualifications,
      confirmKey: this.confirmKey,
      assistant: this.assistant,
      domain: this.domain,
    };
  }

  @Get()
  @ApiOperation({ summary: 'No server stream: the MCP door is stateless (405, Allow: POST)' })
  @HttpCode(HttpStatus.METHOD_NOT_ALLOWED)
  @Header('Allow', 'POST')
  noStream() {
    return {
      jsonrpc: '2.0',
      error: { code: -32000, message: 'Method not allowed.' },
      id: null,
    };
  }
}
