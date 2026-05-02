import {
  Body,
  Controller,
  Delete,
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
import { SubscribeDto } from './dto/notifications.dto';
import { NotificationsService } from './notifications.service';

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
@Controller('notifications')
export class NotificationsController {
  constructor(
    private readonly notifications: NotificationsService,
    private readonly supabase: SupabaseService,
  ) {}

  @Get('vapid-public-key')
  @ApiOperation({ summary: 'Get Web Push VAPID public key' })
  getVapidPublicKey() {
    return this.notifications.getVapidPublicKey();
  }

  @Post('subscribe')
  @HttpCode(HttpStatus.CREATED)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Store current user push subscription' })
  async subscribe(@Body() dto: SubscribeDto, @Req() req: FastifyRequest) {
    const userId = await getClaimedUserId(req, this.supabase);
    const userAgent = req.headers['user-agent'];
    return this.notifications.subscribe(userId, dto, userAgent);
  }

  @Delete('subscribe/:id')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete current user push subscription' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  async unsubscribe(@Param('id', ParseUUIDPipe) id: string, @Req() req: FastifyRequest) {
    const userId = await getClaimedUserId(req, this.supabase);
    return this.notifications.unsubscribe(userId, id);
  }
}
