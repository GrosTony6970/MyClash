import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { requireRequestUserId } from '../../common/auth/request-user';
import { SupabaseService } from '../supabase/supabase.service';
import { BroadcastNotificationsService } from './broadcast-notifications.service';
import { SendBroadcastNotificationDto } from './dto/notifications.dto';

@ApiTags('notifications')
@ApiBearerAuth()
@Controller()
export class BroadcastNotificationsController {
  constructor(
    private readonly broadcasts: BroadcastNotificationsService,
    private readonly supabase: SupabaseService,
  ) {}

  @Post('events/:eventId/notifications/broadcast')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Send an organizer broadcast notification for one event' })
  @ApiParam({ name: 'eventId', type: 'string', format: 'uuid' })
  async sendEventBroadcast(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Body() dto: SendBroadcastNotificationDto,
    @Req() req: FastifyRequest,
  ) {
    const userId = await requireRequestUserId(req, this.supabase);
    return this.broadcasts.sendBroadcast(eventId, userId, dto);
  }

  @Get('events/:eventId/notifications/broadcasts')
  @ApiOperation({ summary: 'List organizer broadcast notification history for one event' })
  @ApiParam({ name: 'eventId', type: 'string', format: 'uuid' })
  async listEventBroadcasts(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Req() req: FastifyRequest,
  ) {
    const userId = await requireRequestUserId(req, this.supabase);
    return this.broadcasts.listEventBroadcasts(eventId, userId);
  }
}
