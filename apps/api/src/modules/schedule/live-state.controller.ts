import { Controller, Get, Param } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/auth/public.decorator';
import { LiveStateService } from './live-state.service';

@ApiTags('schedule')
// Single public read — the controller's own docstring says
// "public endpoint, no auth required"; that was a comment, now it is enforced.
@Public()
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
