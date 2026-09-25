/**
 * conflict-check.controller.ts
 *
 * GET /api/v1/tournaments/:tournamentId/conflict-check
 *
 * The referee verdicts the Pools page of one Tournament shows (hard rule 8, ADR-016).
 *
 * It answers from the one checker, over the whole Event, and keeps what concerns this
 * Tournament (`conflict-check-scope.ts`). It used to run a second detector over this
 * Tournament's Match-scoped rows only, so it could not see a Pool-scoped crew, nor a
 * referee's duty in another Tournament. Authorization is org membership: the answer names
 * fighters and referees.
 *
 * A failed read throws. It used to leave its list empty, and an empty list reads as
 * "nobody is in two places at once": an all-clear nobody had checked. The Pools page says
 * the check failed instead.
 */

import {
  BadRequestException,
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Req,
} from '@nestjs/common';
import { ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { assertTournamentMember } from '../../common/auth/event-authz';
import { resolveRequestUserId } from '../../common/auth/request-user';
import { OrganizationsService } from '../organizations/organizations.service';
import {
  AssignmentBoardService,
  type RefereeConflictEntry,
} from '../referees/assignment-board.service';
import { SupabaseService } from '../supabase/supabase.service';
import { conflictsTouchingTournament } from './conflict-check-scope';

@ApiTags('phases')
@Controller()
export class ConflictCheckController {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly organizations: OrganizationsService,
    private readonly board: AssignmentBoardService,
  ) {}

  @Get('tournaments/:tournamentId/conflict-check')
  @ApiOperation({
    summary: 'Referee verdicts that concern a tournament, from the one checker (org member)',
  })
  @ApiParam({ name: 'tournamentId', type: 'string', format: 'uuid' })
  async checkConflicts(
    @Param('tournamentId', ParseUUIDPipe) tournamentId: string,
    @Req() req: FastifyRequest,
  ): Promise<{ conflicts: RefereeConflictEntry[] }> {
    const userId = await resolveRequestUserId(req, this.supabase);
    await assertTournamentMember(
      { supabase: this.supabase, orgs: this.organizations },
      tournamentId,
      userId,
    );

    const { data: tournamentRow, error: tournamentErr } = await this.supabase.service
      .from('tournaments')
      .select('event_id')
      .eq('id', tournamentId)
      .maybeSingle();
    if (tournamentErr) throw new BadRequestException(tournamentErr.message);
    const eventId = (tournamentRow as { event_id?: string } | null)?.event_id ?? null;
    // `tournaments.event_id` is NOT NULL, so no Event means no Tournament: it went
    // after the membership check. Say so, rather than judge an Event nobody named.
    if (!eventId) throw new NotFoundException('Tournament not found');

    const { conflicts, units } = await this.board.checkEvent(eventId);
    return { conflicts: conflictsTouchingTournament(conflicts, units, tournamentId) };
  }
}
