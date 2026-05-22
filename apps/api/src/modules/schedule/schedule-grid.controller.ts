import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { ScheduleGridService } from './schedule-grid.service';

@ApiTags('schedule')
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
