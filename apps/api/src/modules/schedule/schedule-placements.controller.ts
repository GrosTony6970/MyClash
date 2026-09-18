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
import { SchedulePlacementsDto } from './dto/schedule-placements.dto';
import { SchedulePlacementsService } from './schedule-placements.service';

/**
 * The schedule board's batch save. Its own class, and NOT `@Public()`, for the
 * reason `ScheduleRunController` gives: the grid's read beside it is class-level
 * `@Public()`, so a write added there would be public too.
 *
 * The global AuthGuard runs in shadow mode, so leaving `@Public()` off blocks
 * nobody by itself. The boundary is `assertCanManageEvent` in the service — the
 * editor bar, the same as the single-Match PATCH it replaces on the board. An
 * archived Event is refused by the global EventReadOnlyGuard, which reads
 * `:eventId`.
 */
@ApiTags('schedule')
@Controller()
export class SchedulePlacementsController {
  constructor(
    private readonly placements: SchedulePlacementsService,
    private readonly supabase: SupabaseService,
  ) {}

  /** POST /api/v1/events/:eventId/schedule/placements */
  @Post('events/:eventId/schedule/placements')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Place or unschedule several bouts as one save. The server checks every piste for the whole batch before it writes a row.',
  })
  @ApiParam({ name: 'eventId', type: 'string', format: 'uuid' })
  async savePlacements(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Body() dto: SchedulePlacementsDto,
    @Req() req: FastifyRequest,
  ) {
    return this.placements.savePlacements(
      eventId,
      dto,
      await resolveRequestUserId(req, this.supabase),
    );
  }
}
