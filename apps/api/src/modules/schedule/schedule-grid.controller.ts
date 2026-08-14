import { Controller, Get, Param, ParseUUIDPipe, Req } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { Public } from '../../common/auth/public.decorator';
import { resolveRequestUserId } from '../../common/auth/request-user';
import { SupabaseService } from '../supabase/supabase.service';
import { ScheduleGridService } from './schedule-grid.service';

@ApiTags('schedule')
// Public read: the logged-out tournament-schedule timeline is rendered from this
// server-side with no cookies —
// apps/web-public/app/e/[eventSlug]/schedule/tournaments/_lib/schedule-grid-data.ts:147.
//
// Public does NOT mean unconditional: the projection carries every fighter's
// name, and a DRAFT event's roster is nobody else's business. The service gates
// on event status and falls back to the caller's org membership, which is why
// the request is threaded in. Identity is available here despite @Public()
// because AuthGuard resolves it BEFORE the public check (auth.guard.ts:75-81).
@Public()
@Controller()
export class ScheduleGridController {
  constructor(
    private readonly scheduleGrid: ScheduleGridService,
    private readonly supabase: SupabaseService,
  ) {}

  @Get('events/:eventId/schedule')
  @ApiOperation({ summary: 'List matches for the organizer schedule grid' })
  @ApiParam({ name: 'eventId', type: 'string', format: 'uuid' })
  listEventSchedule(@Param('eventId', ParseUUIDPipe) eventId: string, @Req() req: FastifyRequest) {
    return this.scheduleGrid.listEventSchedule(eventId, () =>
      resolveRequestUserId(req, this.supabase),
    );
  }
}
