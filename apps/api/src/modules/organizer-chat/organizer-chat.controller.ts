import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { buildCorsOrigins } from '../../security/http-security';
import { SupabaseService } from '../supabase/supabase.service';
import {
  CreateConversationDto,
  RenameConversationDto,
  SendMessageDto,
} from './dto/organizer-chat.dto';
import { OrganizerChatService, type ChatStreamEvent } from './organizer-chat.service';

async function getClaimedUserId(req: FastifyRequest, supabase: SupabaseService): Promise<string> {
  const authHeader = req.headers['authorization'];
  const cookies = (req as FastifyRequest & { cookies?: Record<string, string> }).cookies;
  const token = authHeader?.startsWith('Bearer ')
    ? authHeader.slice(7)
    : cookies?.['sb-access-token'];
  if (!token) throw new UnauthorizedException('Authentication required');
  const {
    data: { user },
    error,
  } = await supabase.anon.auth.getUser(token);
  if (error || !user) throw new UnauthorizedException('Invalid token');
  return user.id;
}

@ApiTags('organizer-chat')
@ApiBearerAuth()
@Controller('events/:eventId/chat')
export class OrganizerChatController {
  constructor(
    private readonly chat: OrganizerChatService,
    private readonly supabase: SupabaseService,
  ) {}

  @Post('conversations')
  @ApiOperation({ summary: 'Start an organizer chat conversation' })
  @ApiParam({ name: 'eventId', type: 'string', format: 'uuid' })
  async createConversation(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Body() dto: CreateConversationDto,
    @Req() req: FastifyRequest,
  ) {
    const userId = await getClaimedUserId(req, this.supabase);
    return this.chat.createConversation(eventId, userId, dto);
  }

  @Get('conversations')
  @ApiOperation({ summary: 'List organizer chat conversations for the event' })
  async listConversations(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Req() req: FastifyRequest,
  ) {
    const userId = await getClaimedUserId(req, this.supabase);
    return this.chat.listConversations(eventId, userId);
  }

  @Get('conversations/:conversationId')
  @ApiOperation({ summary: 'Get a conversation with its transcript' })
  async getConversation(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Param('conversationId', ParseUUIDPipe) conversationId: string,
    @Req() req: FastifyRequest,
  ) {
    const userId = await getClaimedUserId(req, this.supabase);
    return this.chat.getConversation(eventId, conversationId, userId);
  }

  @Patch('conversations/:conversationId')
  @ApiOperation({ summary: 'Rename a conversation' })
  async renameConversation(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Param('conversationId', ParseUUIDPipe) conversationId: string,
    @Body() dto: RenameConversationDto,
    @Req() req: FastifyRequest,
  ) {
    const userId = await getClaimedUserId(req, this.supabase);
    return this.chat.renameConversation(eventId, conversationId, userId, dto.title);
  }

  @Delete('conversations/:conversationId')
  @ApiOperation({ summary: 'Delete a conversation and its messages' })
  async deleteConversation(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Param('conversationId', ParseUUIDPipe) conversationId: string,
    @Req() req: FastifyRequest,
  ) {
    const userId = await getClaimedUserId(req, this.supabase);
    return this.chat.deleteConversation(eventId, conversationId, userId);
  }

  @Post('conversations/:conversationId/messages')
  @ApiOperation({ summary: 'Send a message and run the assistant turn' })
  async sendMessage(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Param('conversationId', ParseUUIDPipe) conversationId: string,
    @Body() dto: SendMessageDto,
    @Req() req: FastifyRequest,
  ) {
    const userId = await getClaimedUserId(req, this.supabase);
    return this.chat.sendMessage(eventId, conversationId, userId, dto.content);
  }

  @Post('conversations/:conversationId/messages/stream')
  @ApiOperation({ summary: 'Send a message and stream assistant progress (SSE)' })
  async sendMessageStream(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Param('conversationId', ParseUUIDPipe) conversationId: string,
    @Body() dto: SendMessageDto,
    @Req() req: FastifyRequest,
    @Res() reply: FastifyReply,
  ) {
    // Auth BEFORE hijack, so a 401 flows through the normal exception path.
    const userId = await getClaimedUserId(req, this.supabase);

    const raw = reply.raw;
    raw.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    raw.setHeader('Cache-Control', 'no-cache, no-transform');
    raw.setHeader('Connection', 'keep-alive');
    raw.setHeader('X-Accel-Buffering', 'no'); // don't let a proxy buffer the stream
    const origin = req.headers.origin;
    if (origin && buildCorsOrigins(process.env['DOMAIN'] ?? 'myclash.localhost').includes(origin)) {
      // hijack() bypasses Fastify's CORS hook, so mirror the headers here.
      raw.setHeader('Access-Control-Allow-Origin', origin);
      raw.setHeader('Access-Control-Allow-Credentials', 'true');
      raw.setHeader('Vary', 'Origin');
    }
    reply.hijack();
    raw.flushHeaders?.();

    const send = (event: unknown) => {
      if (!raw.writableEnded) raw.write(`data: ${JSON.stringify(event)}\n\n`);
    };
    // Keepalive so a long single turn doesn't trip a proxy idle timeout.
    const heartbeat = setInterval(() => {
      if (!raw.writableEnded) raw.write(': ping\n\n');
    }, 15000);

    try {
      const conversation = await this.chat.sendMessage(
        eventId,
        conversationId,
        userId,
        dto.content,
        (e: ChatStreamEvent) => send(e),
      );
      send({ type: 'done', conversation });
    } catch (e) {
      send({
        type: 'error',
        message: e instanceof Error ? e.message : 'The request could not be completed.',
      });
    } finally {
      clearInterval(heartbeat);
      if (!raw.writableEnded) raw.end();
    }
  }

  @Post('conversations/:conversationId/proposals/:draftId/confirm')
  @ApiOperation({ summary: 'Confirm and apply a proposed action' })
  async confirmProposal(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Param('conversationId', ParseUUIDPipe) conversationId: string,
    @Param('draftId', ParseUUIDPipe) draftId: string,
    @Req() req: FastifyRequest,
  ) {
    const userId = await getClaimedUserId(req, this.supabase);
    return this.chat.confirmProposal(eventId, conversationId, draftId, userId);
  }

  @Post('conversations/:conversationId/proposals/:draftId/reject')
  @ApiOperation({ summary: 'Dismiss a proposed action' })
  async rejectProposal(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Param('conversationId', ParseUUIDPipe) conversationId: string,
    @Param('draftId', ParseUUIDPipe) draftId: string,
    @Req() req: FastifyRequest,
  ) {
    const userId = await getClaimedUserId(req, this.supabase);
    return this.chat.rejectProposal(eventId, conversationId, draftId, userId);
  }
}
