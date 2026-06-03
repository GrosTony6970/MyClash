/**
 * conflict-check.controller.ts
 *
 * GET /api/v1/tournaments/:tournamentId/conflict-check
 *
 * Returns fighter/referee overlap conflicts for a tournament.
 * Hard constraint: enforce_fighter_referee_no_overlap (AGENTS.md rule #8).
 */

import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import {
  detectFighterRefereeConflicts,
  type ConflictRefereeAssignment,
  type ConflictScheduledMatch,
  type RegistrationPersonMap,
} from '@myclash/rulesets/dist/scheduling/index';
import { SupabaseService } from '../supabase/supabase.service';

@ApiTags('phases')
@Controller()
export class ConflictCheckController {
  constructor(private readonly supabase: SupabaseService) {}

  @Get('tournaments/:tournamentId/conflict-check')
  @ApiOperation({
    summary: 'Check fighter/referee time conflicts for a tournament (hard constraint)',
  })
  @ApiParam({ name: 'tournamentId', type: 'string', format: 'uuid' })
  async checkConflicts(@Param('tournamentId', ParseUUIDPipe) tournamentId: string) {
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

    const matches: ConflictScheduledMatch[] = (matchRows ?? []).map((m) => {
      const r = m as Record<string, unknown>;
      return {
        id: r['id'] as string,
        label: (r['match_number_label'] as string | null) ?? (r['id'] as string),
        redRegistrationId: r['red_registration_id'] as string,
        blueRegistrationId: r['blue_registration_id'] as string,
        scheduledAt: (r['scheduled_at'] as string | null) ?? null,
        durationMinutes: 5,
      };
    });
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

    const refereeAssignments: ConflictRefereeAssignment[] = (refRows ?? []).map((r) => {
      const row = r as Record<string, unknown>;
      const person = row['global_persons'] as {
        id: string;
        given_name: string;
        family_name: string;
      } | null;
      const match = row['matches'] as {
        match_number_label: string | null;
        scheduled_at: string | null;
      } | null;

      return {
        matchId: row['match_id'] as string,
        matchLabel: match?.match_number_label ?? (row['match_id'] as string),
        personId: person?.id ?? '',
        personName: person ? `${person.given_name} ${person.family_name}` : '',
        role: row['role'] as string,
        scheduledAt: match?.scheduled_at ?? null,
        durationMinutes: 5,
      };
    });

    // 3. Fetch registration → person mapping for this tournament
    const { data: regRows } = await this.supabase.service
      .from('registrations')
      .select('id, persons ( id, given_name, family_name )')
      .eq('tournament_id', tournamentId);

    const registrationPersonMap: RegistrationPersonMap[] = (regRows ?? []).map((r) => {
      const row = r as Record<string, unknown>;
      const person = row['persons'] as {
        id: string;
        given_name: string;
        family_name: string;
      } | null;
      return {
        registrationId: row['id'] as string,
        personId: person?.id ?? '',
        personName: person ? `${person.given_name} ${person.family_name}` : '',
      };
    });

    // 4. Run conflict detection
    const result = detectFighterRefereeConflicts(
      matches,
      refereeAssignments,
      registrationPersonMap,
    );

    return result;
  }
}
