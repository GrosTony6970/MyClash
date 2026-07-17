import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/auth/public.decorator';
import { ScheduleGridService } from './schedule-grid.service';

@ApiTags('schedule')
// Public read: the logged-out tournament-schedule timeline is rendered from this
// server-side with no cookies —
// apps/web-public/app/e/[eventSlug]/schedule/tournaments/_lib/schedule-grid-data.ts:147.
@Public()
@Controller()
export class ScheduleGridController {
  constructor(private readonly scheduleGrid: ScheduleGridService) {}

  @Get('events/:eventId/schedule')
  @ApiOperation({ summary: 'List matches for the organizer schedule grid' })
  @ApiParam({ name: 'eventId', type: 'string', format: 'uuid' })
  listEventSchedule(@Param('eventId', ParseUUIDPipe) eventId: string) {
    return this.scheduleGrid.listEventSchedule(eventId);
  }
}
