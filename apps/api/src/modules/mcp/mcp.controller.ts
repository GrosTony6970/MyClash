import { Controller, Get, Header, HttpCode, HttpStatus, Post, Req, Res } from '@nestjs/common';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { MeEventsService } from '../me/me-events.service';
import { McpDoor } from './mcp-door.decorator';
import { mcpCallerOf } from './mcp-door.guard';
import { buildMcpServer } from './mcp-server';

/**
 * The MCP endpoint Claude's connector calls: `POST /api/v1/mcp`, Streamable HTTP, stateless.
 *
 * Each POST builds its own server and transport and closes both when the answer is sent: no
 * session is kept, so no session id is ever issued and a client never sends the DELETE that ends
 * one. A GET would open a stream for the server's own messages, and a stateless server sends none,
 * so it answers 405.
 */
@McpDoor()
@Controller('mcp')
export class McpController {
  constructor(private readonly meEvents: MeEventsService) {}

  @Post()
  async handle(@Req() req: FastifyRequest, @Res() reply: FastifyReply): Promise<void> {
    const caller = mcpCallerOf(req);
    // The transport writes the answer on the raw response; Fastify must not send one too.
    reply.hijack();
    const server = buildMcpServer(caller, { meEvents: this.meEvents });
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    reply.raw.on('close', () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req.raw, reply.raw, req.body);
  }

  @Get()
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
