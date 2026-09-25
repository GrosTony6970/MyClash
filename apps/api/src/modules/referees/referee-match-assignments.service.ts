import { BadRequestException, Injectable } from '@nestjs/common';
import { assertEventMember } from '../../common/auth/event-authz';
import { OrganizationsService } from '../organizations/organizations.service';
import { SupabaseService } from '../supabase/supabase.service';
import { switchesOf } from './event-commitments';
import { SettingsService } from './settings.service';
import {
  toRefereeMatchAssignments,
  toRegistrationPersons,
  type RawRefereeAssignmentRow,
  type RawRegistrationRow,
  type RefereeMatchAssignmentsPayload,
} from './referee-match-assignments';

/**
 * Serves the schedule board what it needs to run the one referee checker
 * (ADR-016) for itself, on every card move.
 *
 * The board already holds every bout and re-derives fighter conflicts on each
 * render. It cannot do the same for referees because it has no idea who is
 * refereeing what, nor which person a registration belongs to, nor which amber
 * rules the Event switched on. So this endpoint hands over those INPUTS rather
 * than a computed answer — a computed answer would be stale the instant a card
 * moved, which is the whole failure the board's own derivation exists to avoid.
 * Both scopes: a Pool crew is one Pool-scoped row, and a read of bout rows only
 * never saw it. A piste-scoped row has no window rule and stays out.
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
    private readonly settings: SettingsService,
  ) {}

  async getForEvent(eventId: string, userId: string): Promise<RefereeMatchAssignmentsPayload> {
    // Staff data: any member of the organisation, published or not. See
    // `assertEventMember` for why this is not the public read gate.
    await assertEventMember({ supabase: this.supabase, orgs: this.organizations }, eventId, userId);

    // `referee_assignments.event_id` is a real column, so the per-match crew
    // needs no walk down through tournaments and phases.
    const { data: assignmentRows, error: assignmentErr } = await this.supabase.service
      .from('referee_assignments')
      .select(
        'scope_type, match_id, pool_id, role, conflicts_jsonb, global_persons ( id, given_name, family_name, display_name )',
      )
      .eq('event_id', eventId)
      .in('scope_type', ['match', 'pool'])
      .limit(ROW_LIMIT);
    if (assignmentErr) throw new BadRequestException(assignmentErr.message);

    const assignments = toRefereeMatchAssignments(
      (assignmentRows ?? []) as unknown as RawRefereeAssignmentRow[],
    );
    const rules = switchesOf(await this.settings.getSettings(eventId));

    // `registrations` keys on `tournament_id` and carries no event id, so the
    // event's tournaments have to be resolved first.
    const { data: tournamentRows, error: tournamentErr } = await this.supabase.service
      .from('tournaments')
      .select('id')
      .eq('event_id', eventId);
    if (tournamentErr) throw new BadRequestException(tournamentErr.message);
    const tournamentIds = ((tournamentRows ?? []) as Array<{ id: string }>).map((t) => t.id);
    if (tournamentIds.length === 0) return { assignments, registrations: [], rules };

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
      rules,
    };
  }
}
