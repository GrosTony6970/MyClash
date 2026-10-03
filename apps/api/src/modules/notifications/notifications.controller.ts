import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { Public } from '../../common/auth/public.decorator';
import { SupabaseService } from '../supabase/supabase.service';
import { BroadcastNotificationsService } from './broadcast-notifications.service';
import {
  PushAddressDto,
  SubscribeDto,
  UpdateNotificationPreferencesDto,
} from './dto/notifications.dto';
import { NotificationsService } from './notifications.service';

async function getClaimedUserId(req: FastifyRequest, supabase: SupabaseService): Promise<string> {
  const authHeader = req.headers['authorization'];
  const cookies = (req as FastifyRequest & { cookies?: Record<string, string> }).cookies;
  const token = authHeader?.startsWith('Bearer ')
    ? authHeader.slice(7)
    : cookies?.['sb-access-token'];

  if (!token) throw new UnauthorizedException('Authentication required');

  const user = await supabase.getAuthUser(token);
  if (!user) throw new UnauthorizedException('Invalid token');
  return user.id;
}

@ApiTags('notifications')
@Controller('notifications')
export class NotificationsController {
  constructor(
    private readonly notifications: NotificationsService,
    private readonly broadcasts: BroadcastNotificationsService,
    private readonly supabase: SupabaseService,
  ) {}

  @Public()
  @Get('vapid-public-key')
  @ApiOperation({ summary: 'Get Web Push VAPID public key (public)' })
  getVapidPublicKey() {
    return this.notifications.getVapidPublicKey();
  }

  @Post('me/subscribe')
  @HttpCode(HttpStatus.CREATED)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Save this browser's push address for the current user" })
  async subscribe(@Body() dto: SubscribeDto, @Req() req: FastifyRequest) {
    const userId = await getClaimedUserId(req, this.supabase);
    const userAgent = req.headers['user-agent'];
    return this.notifications.subscribe(userId, dto, userAgent);
  }

  @Get('preferences')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get current user notification preferences' })
  async getPreferences(@Req() req: FastifyRequest) {
    const userId = await getClaimedUserId(req, this.supabase);
    return this.notifications.getPreferences(userId);
  }

  @Patch('preferences')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update current user notification preferences' })
  async updatePreferences(
    @Body() dto: UpdateNotificationPreferencesDto,
    @Req() req: FastifyRequest,
  ) {
    const userId = await getClaimedUserId(req, this.supabase);
    return this.notifications.updatePreferences(userId, dto);
  }

  @Get('broadcasts')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List current user broadcast notification history' })
  async listUserBroadcasts(@Req() req: FastifyRequest) {
    const userId = await getClaimedUserId(req, this.supabase);
    return this.broadcasts.listUserBroadcasts(userId);
  }

  @Post('me/unsubscribe')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Remove this browser's push address from the current user" })
  async unsubscribe(@Body() dto: PushAddressDto, @Req() req: FastifyRequest) {
    const userId = await getClaimedUserId(req, this.supabase);
    return this.notifications.unsubscribe(userId, dto.endpoint);
  }

  @Post('me/subscribed')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Is this browser's push address saved for the current user?" })
  async isSubscribed(@Body() dto: PushAddressDto, @Req() req: FastifyRequest) {
    const userId = await getClaimedUserId(req, this.supabase);
    return this.notifications.isSubscribed(userId, dto.endpoint);
  }
}
