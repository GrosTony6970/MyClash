import { Controller, Get, Param } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { LiveStateService } from './live-state.service';

@ApiTags('schedule')
@Controller()
export class LiveStateController {
  constructor(private readonly liveState: LiveStateService) {}

  /** Accepts event UUID or slug — public endpoint, no auth required. */
  @Get('events/:eventId/live-state')
  @ApiOperation({ summary: 'Current programme block and per-lice match state (public)' })
  @ApiParam({ name: 'eventId', type: 'string', description: 'Event UUID or slug' })
  getLiveState(@Param('eventId') eventId: string) {
    return this.liveState.getLiveState(eventId);
  }
}
