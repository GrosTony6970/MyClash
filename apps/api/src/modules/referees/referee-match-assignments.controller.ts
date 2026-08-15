import { Controller, Get, Param, ParseUUIDPipe, Req } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { resolveRequestUserId } from '../../common/auth/request-user';
import { SupabaseService } from '../supabase/supabase.service';
import { RefereeMatchAssignmentsService } from './referee-match-assignments.service';

/**
 * The per-match referee inputs the schedule board checks its own conflicts
 * against. See ./referee-match-assignments.service for why this hands over
 * inputs rather than a computed answer.
 *
 * Its own controller rather than a twelfth route on `AssignmentBoardController`:
 * that controller authorizes none of its eleven routes, and this one has to.
 * Keeping the guarded surface separate makes which is which visible instead of
 * implied.
 */
@ApiTags('referees')
@Controller()
export class RefereeMatchAssignmentsController {
  constructor(
    private readonly assignments: RefereeMatchAssignmentsService,
    private readonly supabase: SupabaseService,
  ) {}

  @Get('events/:eventId/referee-match-assignments')
  @ApiOperation({
    summary:
      'Per-match referee assignments plus the registration→person map, for client-side conflict detection (org member)',
  })
  @ApiParam({ name: 'eventId', type: 'string', format: 'uuid' })
  async getForEvent(@Param('eventId', ParseUUIDPipe) eventId: string, @Req() req: FastifyRequest) {
    // The sentinel, not a throw: the org-role assertion downstream turns an
    // anonymous caller into a 403 that says what was wrong.
    const userId = await resolveRequestUserId(req, this.supabase);
    return this.assignments.getForEvent(eventId, userId);
  }
}
