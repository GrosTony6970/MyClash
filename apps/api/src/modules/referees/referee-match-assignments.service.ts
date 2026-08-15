import { BadRequestException, Injectable } from '@nestjs/common';
import { assertEventMember } from '../../common/auth/event-authz';
import { OrganizationsService } from '../organizations/organizations.service';
import { SupabaseService } from '../supabase/supabase.service';
import {
  toRefereeMatchAssignments,
  toRegistrationPersons,
  type RawRefereeAssignmentRow,
  type RawRegistrationRow,
  type RefereeMatchAssignmentsPayload,
} from './referee-match-assignments';

/**
 * Serves the schedule board the two things it needs to check referee conflicts
 * for itself.
 *
 * The board already holds every bout and re-derives fighter conflicts on each
 * render. It cannot do the same for referees because it has no idea who is
 * refereeing what, nor which person a registration belongs to. Those are exactly
 * the second and third arguments of `detectFighterRefereeConflicts`, so this
 * endpoint hands over the INPUTS rather than a computed answer — a computed
 * answer would be stale the instant a card moved, which is the whole failure the
 * board's own fighter-conflict derivation exists to avoid.
 *
 * Scope is the EVENT, not a tournament. A referee crossing from one tournament's
 * pool to another's bracket is the case most likely to be missed by eye, and a
 * per-tournament read cannot see it.
 *
 * Rows to payload is in ./referee-match-assignments, which is pure and carries
 * the id-space rule. This file is the query and the authorization.
 */

/**
 * Same explicit limit `schedule-grid.service.ts` uses. PostgREST deployments
 * with a `max-rows` cap truncate silently, and a truncated conflict input does
 * not look broken — it looks like a clean board.
 */
const ROW_LIMIT = 10_000;

@Injectable()
export class RefereeMatchAssignmentsService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly organizations: OrganizationsService,
  ) {}

  async getForEvent(eventId: string, userId: string): Promise<RefereeMatchAssignmentsPayload> {
    // Staff data: any member of the organisation, published or not. See
    // `assertEventMember` for why this is not the public read gate.
    await assertEventMember({ supabase: this.supabase, orgs: this.organizations }, eventId, userId);

    // `referee_assignments.event_id` is a real column, so the per-match crew
    // needs no walk down through tournaments and phases.
    const { data: assignmentRows, error: assignmentErr } = await this.supabase.service
      .from('referee_assignments')
      .select('match_id, role, global_persons ( id, given_name, family_name, display_name )')
      .eq('event_id', eventId)
      .eq('scope_type', 'match')
      .limit(ROW_LIMIT);
    if (assignmentErr) throw new BadRequestException(assignmentErr.message);

    const assignments = toRefereeMatchAssignments(
      (assignmentRows ?? []) as unknown as RawRefereeAssignmentRow[],
    );

    // `registrations` keys on `tournament_id` and carries no event id, so the
    // event's tournaments have to be resolved first.
    const { data: tournamentRows, error: tournamentErr } = await this.supabase.service
      .from('tournaments')
      .select('id')
      .eq('event_id', eventId);
    if (tournamentErr) throw new BadRequestException(tournamentErr.message);
    const tournamentIds = ((tournamentRows ?? []) as Array<{ id: string }>).map((t) => t.id);
    if (tournamentIds.length === 0) return { assignments, registrations: [] };

    const { data: registrationRows, error: registrationErr } = await this.supabase.service
      .from('registrations')
      .select('id, persons ( id, global_person_id, given_name, family_name, display_name )')
      .in('tournament_id', tournamentIds)
      .limit(ROW_LIMIT);
    if (registrationErr) throw new BadRequestException(registrationErr.message);

    return {
      assignments,
      registrations: toRegistrationPersons(
        (registrationRows ?? []) as unknown as RawRegistrationRow[],
      ),
    };
  }
}
