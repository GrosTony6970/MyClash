/**
 * conflict-check.controller.ts
 *
 * GET /api/v1/tournaments/:tournamentId/conflict-check
 *
 * Returns fighter/referee overlap conflicts for a tournament.
 * Hard constraint: enforce_fighter_referee_no_overlap (AGENTS.md rule #8).
 *
 * Row-to-input mapping lives in ./conflict-check-inputs, which is pure and
 * carries the id-space rule this endpoint got wrong. Authorization is org
 * membership: the answer names fighters and referees.
 */

import { Controller, Get, Param, ParseUUIDPipe, Req } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { detectFighterRefereeConflicts } from '@myclash/rulesets/scheduling';
import { assertTournamentMember } from '../../common/auth/event-authz';
import { resolveRequestUserId } from '../../common/auth/request-user';
import { OrganizationsService } from '../organizations/organizations.service';
import { SupabaseService } from '../supabase/supabase.service';
import {
  toConflictAssignments,
  toConflictMatches,
  toRegistrationPersonMap,
  type RawConflictAssignmentRow,
  type RawConflictMatchRow,
  type RawConflictRegistrationRow,
} from './conflict-check-inputs';

@ApiTags('phases')
@Controller()
export class ConflictCheckController {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly organizations: OrganizationsService,
  ) {}

  @Get('tournaments/:tournamentId/conflict-check')
  @ApiOperation({
    summary: 'Check fighter/referee time conflicts for a tournament (hard constraint, org member)',
  })
  @ApiParam({ name: 'tournamentId', type: 'string', format: 'uuid' })
  async checkConflicts(
    @Param('tournamentId', ParseUUIDPipe) tournamentId: string,
    @Req() req: FastifyRequest,
  ) {
    const userId = await resolveRequestUserId(req, this.supabase);
    await assertTournamentMember(
      { supabase: this.supabase, orgs: this.organizations },
      tournamentId,
      userId,
    );

    // 0. Resolve the tournament → event scope + phase ids. Neither
    // `matches.tournament_id` nor `referee_assignments.tournament_id`
    // exists in the schema (matches link to phases; phases link to
    // tournaments; referee_assignments are event-scoped). Pre-resolving
    // here keeps the downstream filters honest.
    const { data: tournamentRow } = await this.supabase.service
      .from('tournaments')
      .select('event_id')
      .eq('id', tournamentId)
      .maybeSingle();
    const eventId = (tournamentRow as { event_id?: string } | null)?.event_id ?? null;

    const { data: phaseRows } = await this.supabase.service
      .from('phases')
      .select('id')
      .eq('tournament_id', tournamentId);
    const phaseIds = ((phaseRows ?? []) as Array<{ id: string }>).map((p) => p.id);

    // 1. Fetch all matches for this tournament's phases with scheduled_at.
    const { data: matchRows } = phaseIds.length
      ? await this.supabase.service
          .from('matches')
          .select('id, match_number_label, red_registration_id, blue_registration_id, scheduled_at')
          .in('phase_id', phaseIds)
          .neq('status', 'voided')
      : { data: [] };

    const matches = toConflictMatches((matchRows ?? []) as unknown as RawConflictMatchRow[]);
    const matchIds = matches.map((m) => m.id);

    // 2. Fetch referee assignments scoped to this tournament's matches.
    // Post-0063: referee_assignments.person_id → global_persons.
    const { data: refRows } =
      eventId && matchIds.length
        ? await this.supabase.service
            .from('referee_assignments')
            .select(
              `
        match_id, role,
        global_persons ( id, given_name, family_name ),
        matches ( match_number_label, scheduled_at )
      `,
            )
            .eq('event_id', eventId)
            .in('match_id', matchIds)
        : { data: [] };

    // 3. Fetch registration → person mapping for this tournament.
    //    Projects `persons.global_person_id` (not `persons.id`) so the map keys
    //    live in the same id-space as `referee_assignments.person_id`.
    const { data: regRows } = await this.supabase.service
      .from('registrations')
      .select('id, persons ( id, global_person_id, given_name, family_name )')
      .eq('tournament_id', tournamentId);

    // 4. Run conflict detection. Rows whose person cannot be resolved are
    //    dropped by the mappers rather than keyed under '' — see
    //    ./conflict-check-inputs for the false alarm that produced.
    return detectFighterRefereeConflicts(
      matches,
      toConflictAssignments((refRows ?? []) as unknown as RawConflictAssignmentRow[]),
      toRegistrationPersonMap((regRows ?? []) as unknown as RawConflictRegistrationRow[]),
    );
  }
}
