import { Controller, Get, Param, ParseUUIDPipe, Req } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { publicReader } from '../../common/auth/competition-visibility';
import { Public } from '../../common/auth/public.decorator';
import { ScheduleGridService } from './schedule-grid.service';

@ApiTags('schedule')
// Public read: the logged-out tournament-schedule timeline is rendered from this
// server-side with no cookies —
// apps/web-public/app/e/[eventSlug]/schedule/tournaments/_lib/schedule-grid-data.ts:147.
//
// Public does NOT mean unconditional: the projection carries every fighter's
// name, and a DRAFT event's roster — or a draft Tournament's — is nobody else's
// business. The service gates on the event and on each Tournament's status and
// lets the Event's club and its active staff see the rest (ruling 129), which is
// why the reader is threaded in. Identity is available here despite @Public()
// because AuthGuard resolves it BEFORE the public check (auth.guard.ts:75-81).
@Public()
@Controller()
export class ScheduleGridController {
  constructor(private readonly scheduleGrid: ScheduleGridService) {}

  @Get('events/:eventId/schedule')
  @ApiOperation({ summary: 'List matches for the organizer schedule grid' })
  @ApiParam({ name: 'eventId', type: 'string', format: 'uuid' })
  listEventSchedule(@Param('eventId', ParseUUIDPipe) eventId: string, @Req() req: FastifyRequest) {
    return this.scheduleGrid.listEventSchedule(eventId, publicReader(req));
  }
}
