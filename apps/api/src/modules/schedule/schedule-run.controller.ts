import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { resolveRequestUserId } from '../../common/auth/request-user';
import { SupabaseService } from '../supabase/supabase.service';
import { ScheduleRunDto } from './dto/schedule-run.dto';
import { ScheduleRunService } from './schedule-run.service';

/**
 * The run window's save. Its own class, and NOT `@Public()`: the grid's read,
 * `ScheduleGridController`, is class-level `@Public()` for the logged-out
 * timeline, so a write added there would be public too.
 *
 * The global AuthGuard runs in shadow mode, so leaving `@Public()` off blocks
 * nobody by itself. The boundary is `assertCanManageEvent` in the service — the
 * editor bar, the same as the single-Match PATCH — which refuses an anonymous
 * caller with a 403. An archived Event is refused by the global
 * EventReadOnlyGuard, which reads `:eventId`; re-timing a completed Event stays
 * allowed, as it is for the single PATCH.
 */
@ApiTags('schedule')
@Controller()
export class ScheduleRunController {
  constructor(
    private readonly scheduleRun: ScheduleRunService,
    private readonly supabase: SupabaseService,
  ) {}

  /** POST /api/v1/events/:eventId/schedule/run */
  @Post('events/:eventId/schedule/run')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Move one run of bouts to a start and, optionally, set or clear its bout length. The server lays the run and checks every piste in one save.',
  })
  @ApiParam({ name: 'eventId', type: 'string', format: 'uuid' })
  async saveRun(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Body() dto: ScheduleRunDto,
    @Req() req: FastifyRequest,
  ) {
    return this.scheduleRun.saveRun(eventId, dto, await resolveRequestUserId(req, this.supabase));
  }
}
