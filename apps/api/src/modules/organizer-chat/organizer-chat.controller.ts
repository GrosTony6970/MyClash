import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { SupabaseService } from '../supabase/supabase.service';
import { CreateConversationDto, SendMessageDto } from './dto/organizer-chat.dto';
import { OrganizerChatService } from './organizer-chat.service';

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
