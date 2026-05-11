import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { SupabaseService } from '../supabase/supabase.service';
import {
  CreateOrganizerAIDraftDto,
  UpdateOrganizerAIDraftDto,
} from './dto/organizer-ai-assistant.dto';
import { OrganizerAIAssistantService } from './organizer-ai-assistant.service';

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

@ApiTags('organizer-ai-assistant')
@ApiBearerAuth()
@Controller('events/:eventId/ai-assistant/drafts')
export class OrganizerAIAssistantController {
  constructor(
    private readonly assistant: OrganizerAIAssistantService,
    private readonly supabase: SupabaseService,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Create an organizer AI setup draft' })
  @ApiParam({ name: 'eventId', type: 'string', format: 'uuid' })
  async create(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Body() dto: CreateOrganizerAIDraftDto,
    @Req() req: FastifyRequest,
  ) {
    const userId = await getClaimedUserId(req, this.supabase);
    return this.assistant.createDraft(eventId, userId, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List organizer AI setup drafts' })
  async list(@Param('eventId', ParseUUIDPipe) eventId: string, @Req() req: FastifyRequest) {
    const userId = await getClaimedUserId(req, this.supabase);
    return this.assistant.listDrafts(eventId, userId);
  }

  @Get(':draftId')
  @ApiOperation({ summary: 'Get one organizer AI setup draft' })
  async get(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Param('draftId', ParseUUIDPipe) draftId: string,
    @Req() req: FastifyRequest,
  ) {
    const userId = await getClaimedUserId(req, this.supabase);
    return this.assistant.getDraft(eventId, draftId, userId);
  }

  @Patch(':draftId')
  @ApiOperation({ summary: 'Update or reject an organizer AI setup draft' })
  async update(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Param('draftId', ParseUUIDPipe) draftId: string,
    @Body() dto: UpdateOrganizerAIDraftDto,
    @Req() req: FastifyRequest,
  ) {
    const userId = await getClaimedUserId(req, this.supabase);
    return this.assistant.updateDraft(eventId, draftId, userId, dto);
  }

  @Post(':draftId/apply')
  @ApiOperation({ summary: 'Apply a reviewed organizer AI setup draft' })
  async apply(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Param('draftId', ParseUUIDPipe) draftId: string,
    @Req() req: FastifyRequest,
  ) {
    const userId = await getClaimedUserId(req, this.supabase);
    return this.assistant.applyDraft(eventId, draftId, userId);
  }
}
