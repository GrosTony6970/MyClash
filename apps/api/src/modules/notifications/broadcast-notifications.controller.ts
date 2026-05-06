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
  UnauthorizedException,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { SupabaseService } from '../supabase/supabase.service';
import { BroadcastNotificationsService } from './broadcast-notifications.service';
import { SendBroadcastNotificationDto } from './dto/notifications.dto';

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
    const userId = await getClaimedUserId(req, this.supabase);
    return this.broadcasts.sendBroadcast(eventId, userId, dto);
  }

  @Get('events/:eventId/notifications/broadcasts')
  @ApiOperation({ summary: 'List organizer broadcast notification history for one event' })
  @ApiParam({ name: 'eventId', type: 'string', format: 'uuid' })
  async listEventBroadcasts(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Req() req: FastifyRequest,
  ) {
    const userId = await getClaimedUserId(req, this.supabase);
    return this.broadcasts.listEventBroadcasts(eventId, userId);
  }
}
