import { Controller, Get, Param, Req } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { FastifyRequest } from 'fastify';
import { Public } from '../../common/auth/public.decorator';
import { resolveRequestUserId } from '../../common/auth/request-user';
import { SupabaseService } from '../supabase/supabase.service';
import { PUBLIC_LIVE_READ_THROTTLE } from '../../common/throttling/throttle-profiles';
import { LiveStateService } from './live-state.service';

@ApiTags('schedule')
// Single public read — the controller's own docstring says
// "public endpoint, no auth required"; that was a comment, now it is enforced.
@Public()
@Controller()
export class LiveStateController {
  constructor(
    private readonly liveState: LiveStateService,
    private readonly supabase: SupabaseService,
  ) {}

  /**
   * Accepts event UUID or slug — public endpoint, no auth required.
   *
   * Unauthenticated and polled from the venue: hall displays and every
   * spectator phone on the same wifi draw on one bucket, because `req.ip` is
   * the shared public address. This is the venue-shaped read
   * PUBLIC_LIVE_READ_THROTTLE was sized for.
   */
  @Get('events/:eventId/live-state')
  @Throttle(PUBLIC_LIVE_READ_THROTTLE)
  @ApiOperation({ summary: 'Current programme block and per-lice match state (public)' })
  @ApiParam({ name: 'eventId', type: 'string', description: 'Event UUID or slug' })
  getLiveState(@Param('eventId') eventId: string, @Req() req: FastifyRequest) {
    return this.liveState.getLiveState(eventId, () => resolveRequestUserId(req, this.supabase));
  }
}
