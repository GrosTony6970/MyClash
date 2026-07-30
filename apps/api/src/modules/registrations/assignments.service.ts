import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';

/**
 * Operational blocking set for force-delete: a match in any of these
 * statuses prevents a participant from being purged. Matches that
 * haven't been played yet (scheduled / ready / pending) are fine —
 * the force-delete flow voids them.
 *
 * Mirrored verbatim by the FE modal's red-banner rendering. If you
 * change this set, the FE copy needs the same update.
 */
export const BLOCKING_MATCH_STATUSES = [
  'running',
  'paused',
  'completed',
  'forfeit',
  'disqualified',
] as const;

export type BlockingMatchStatus = (typeof BLOCKING_MATCH_STATUSES)[number];

function isBlocking(status: string | null | undefined): boolean {
  return (BLOCKING_MATCH_STATUSES as readonly string[]).includes(status ?? '');
}

export interface AssignmentSummary {
  poolId?: string;
  poolName?: string;
  slotId?: string;
  round?: number;
  position?: number;
  matchId?: string;
  label?: string;
  status?: string;
  role?: string;
  assignmentId?: string;
  scopeType?: string;
  scopeId?: string | null;
  tournamentId: string;
  tournamentName: string;
}

export interface BlockingMatchEntry {
  matchId: string;
  label: string;
  status: string;
  reason: 'fighter' | 'referee';
}

export interface AssignmentReport {
  personId: string;
  pools: AssignmentSummary[];
  bracketSlots: AssignmentSummary[];
  matchesAsFighter: AssignmentSummary[];
  matchesAsReferee: AssignmentSummary[];
  refereeAssignments: AssignmentSummary[];
  blockingMatches: BlockingMatchEntry[];
  hasBlockingMatch: boolean;
}

/** PostgREST embeds resolve as either a single row or an array depending on
 *  FK cardinality; tolerate both. */
type Embed<T> = T | T[] | null;

function firstEmbed<T>(value: Embed<T>): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

interface RegistrationRow {
  id: string;
  tournament_id: string;
  tournaments: Embed<{ id: string; name: string; event_id: string }>;
}

@Injectable()
export class AssignmentsService {
  constructor(private readonly supabase: SupabaseService) {}

  /**
   * One-shot probe: where is `personId` currently assigned within `eventId`?
   * Optional `tournamentId` narrows every list to that single tournament —
   * used by the per-tournament Unassign modal.
   *
   * The returned `hasBlockingMatch` is the single source of truth for the
   * force-delete guard. Both Slice B (registration) and Slice C (person)
   * call this method and refuse the delete when `true`.
   */
  async getEventAssignments(
    eventId: string,
    personId: string,
    tournamentId?: string,
  ): Promise<AssignmentReport> {
    // 1. Every registration this person has in this event.
    const { data: regRows, error: regErr } = await this.supabase.service
      .from('registrations')
      .select('id, tournament_id, tournaments!inner(id, name, event_id)')
      .eq('person_id', personId)
      .eq('tournaments.event_id', eventId);
    if (regErr) throw new BadRequestException(regErr.message);

    const allRegs = ((regRows ?? []) as unknown as RegistrationRow[]).filter(
      (r) => firstEmbed(r.tournaments)?.event_id === eventId,
    );
    const regs = tournamentId ? allRegs.filter((r) => r.tournament_id === tournamentId) : allRegs;
    const regIds = regs.map((r) => r.id);
    const regToTournament = new Map<string, { id: string; name: string }>();
    for (const r of regs) {
      regToTournament.set(r.id, {
        id: r.tournament_id,
        name: firstEmbed(r.tournaments)?.name ?? '',
      });
    }

    // 2. Pool memberships for these registrations.
    let pools: AssignmentSummary[] = [];
    if (regIds.length > 0) {
      const { data: poolRows } = await this.supabase.service
        .from('pool_members')
        .select('registration_id, pools(id, name, phases(tournament_id, tournaments(id, name)))')
        .in('registration_id', regIds);
      pools = (
        (poolRows ?? []) as unknown as Array<{
          registration_id: string;
          pools: Embed<{
            id: string;
            name: string;
            phases: Embed<{
              tournament_id: string;
              tournaments: Embed<{ id: string; name: string }>;
            }>;
          }>;
        }>
      )
        .map((row) => {
          const pool = firstEmbed(row.pools);
          const t = regToTournament.get(row.registration_id);
          if (!pool || !t) return null;
          return {
            poolId: pool.id,
            poolName: pool.name,
            tournamentId: t.id,
            tournamentName: t.name,
          } as AssignmentSummary;
        })
        .filter((x): x is AssignmentSummary => x !== null);
    }

    // 3. Bracket slots referencing these registrations.
    let bracketSlots: AssignmentSummary[] = [];
    if (regIds.length > 0) {
      const inList = regIds.join(',');
      const { data: slotRows } = await this.supabase.service
        .from('bracket_slots')
        .select(
          'id, round, position, registration_a_id, registration_b_id, phases(tournament_id, tournaments(id, name))',
        )
        .or(`registration_a_id.in.(${inList}),registration_b_id.in.(${inList})`);
      bracketSlots = (
        (slotRows ?? []) as unknown as Array<{
          id: string;
          round: number;
          position: number;
          registration_a_id: string | null;
          registration_b_id: string | null;
          phases: Embed<{
            tournament_id: string;
            tournaments: Embed<{ id: string; name: string }>;
          }>;
        }>
      )
        .map((row) => {
          const phase = firstEmbed(row.phases);
          const tId = phase?.tournament_id;
          if (!tId) return null;
          if (tournamentId && tId !== tournamentId) return null;
          return {
            slotId: row.id,
            round: row.round,
            position: row.position,
            tournamentId: tId,
            tournamentName: firstEmbed(phase.tournaments)?.name ?? '',
          } as AssignmentSummary;
        })
        .filter((x): x is AssignmentSummary => x !== null);
    }

    // 4. Matches as fighter (red/blue), via the canonical view.
    let matchesAsFighter: AssignmentSummary[] = [];
    if (regIds.length > 0) {
      const inList = regIds.join(',');
      const { data: matchRows } = await this.supabase.service
        .from('vw_tournament_query_matches')
        .select(
          'match_id, match_number_label, status, tournament_id, tournament_name, red_registration_id, blue_registration_id',
        )
        .or(`red_registration_id.in.(${inList}),blue_registration_id.in.(${inList})`);
      matchesAsFighter = (
        (matchRows ?? []) as unknown as Array<{
          match_id: string;
          match_number_label: string | null;
          status: string;
          tournament_id: string;
          tournament_name: string;
        }>
      )
        .filter((row) => !tournamentId || row.tournament_id === tournamentId)
        .map((row) => ({
          matchId: row.match_id,
          label: row.match_number_label ?? '',
          status: row.status,
          tournamentId: row.tournament_id,
          tournamentName: row.tournament_name,
        }));
    }

    // 5. Matches as referee — two sources: legacy matches.referee_id and the
    //    referee_assignments table (scope_type='match'). Merge by match_id.
    const matchesAsRefereeMap = new Map<string, AssignmentSummary>();

    // `matches` has NO tournament_id — it reaches its tournament through
    // `phases` (0001), exactly as the pool branch below already does. Naming it
    // directly 400'd the query, so `legacyRefMatches` was always undefined and
    // a referee's match assignments never appeared on this surface at all.
    const { data: legacyRefMatches } = await this.supabase.service
      .from('matches')
      .select('id, match_number_label, status, referee_id, phases(tournament_id)')
      .eq('referee_id', personId);
    for (const row of (legacyRefMatches ?? []) as unknown as Array<{
      id: string;
      match_number_label: string | null;
      status: string;
      phases: Embed<{ tournament_id: string }>;
    }>) {
      const rowTournamentId = firstEmbed(row.phases)?.tournament_id ?? null;
      if (!rowTournamentId) continue;
      if (tournamentId && rowTournamentId !== tournamentId) continue;
      const t = regs.find((r) => r.tournament_id === rowTournamentId);
      matchesAsRefereeMap.set(row.id, {
        matchId: row.id,
        label: row.match_number_label ?? '',
        status: row.status,
        role: 'referee',
        tournamentId: rowTournamentId,
        tournamentName: firstEmbed(t?.tournaments ?? null)?.name ?? '',
      });
    }

    // 6. Referee assignments (scope-aware).
    const { data: refAssignments } = await this.supabase.service
      .from('referee_assignments')
      .select(
        // The match branch traverses phases for the same reason the pool branch
        // does: there is no matches.tournament_id and no matches→tournaments FK,
        // so the old `matches(…, tournament_id, tournaments(…))` 400'd the whole
        // query and every referee assignment read back empty.
        'id, scope_type, pool_id, match_id, role, pools(phases(tournament_id, tournaments(id, name))), matches(id, match_number_label, status, phases(tournament_id, tournaments(id, name)))',
      )
      .eq('person_id', personId);
    const refereeAssignments: AssignmentSummary[] = [];
    for (const row of (refAssignments ?? []) as unknown as Array<{
      id: string;
      scope_type: string;
      pool_id: string | null;
      match_id: string | null;
      role: string;
      pools: Embed<{
        phases: Embed<{
          tournament_id: string;
          tournaments: Embed<{ id: string; name: string }>;
        }>;
      }>;
      matches: Embed<{
        id: string;
        match_number_label: string | null;
        status: string;
        phases: Embed<{
          tournament_id: string;
          tournaments: Embed<{ id: string; name: string }>;
        }>;
      }>;
    }>) {
      const poolPhase = firstEmbed(firstEmbed(row.pools)?.phases ?? null);
      const matchRow = firstEmbed(row.matches);
      const matchPhase = firstEmbed(matchRow?.phases ?? null);
      const tId = poolPhase?.tournament_id ?? matchPhase?.tournament_id ?? null;
      if (!tId) continue;
      if (tournamentId && tId !== tournamentId) continue;
      const tName =
        firstEmbed(poolPhase?.tournaments ?? null)?.name ??
        firstEmbed(matchPhase?.tournaments ?? null)?.name ??
        '';
      refereeAssignments.push({
        assignmentId: row.id,
        scopeType: row.scope_type,
        scopeId: row.match_id ?? row.pool_id ?? null,
        role: row.role,
        tournamentId: tId,
        tournamentName: tName,
      });
      if (row.scope_type === 'match' && matchRow) {
        matchesAsRefereeMap.set(matchRow.id, {
          matchId: matchRow.id,
          label: matchRow.match_number_label ?? '',
          status: matchRow.status,
          role: row.role,
          tournamentId: tId,
          tournamentName: tName,
        });
      }
    }

    const matchesAsReferee = Array.from(matchesAsRefereeMap.values());

    // 7. Compute blocking set across both fighter + referee surfaces.
    const blockingMatches: BlockingMatchEntry[] = [];
    for (const m of matchesAsFighter) {
      if (isBlocking(m.status)) {
        blockingMatches.push({
          matchId: m.matchId!,
          label: m.label!,
          status: m.status!,
          reason: 'fighter',
        });
      }
    }
    for (const m of matchesAsReferee) {
      if (isBlocking(m.status)) {
        blockingMatches.push({
          matchId: m.matchId!,
          label: m.label!,
          status: m.status!,
          reason: 'referee',
        });
      }
    }

    return {
      personId,
      pools,
      bracketSlots,
      matchesAsFighter,
      matchesAsReferee,
      refereeAssignments,
      blockingMatches,
      hasBlockingMatch: blockingMatches.length > 0,
    };
  }

  /**
   * Force-delete a single registration. The guard rejects with 409 if
   * the registration's person has any blocking match in the same
   * tournament. Otherwise: hard-delete the unplayed matches that
   * reference this registration (releases the matches FK RESTRICT),
   * then delete the registration (pool_members cascade, bracket_slots
   * null out).
   *
   * Does NOT touch the person row or referee assignments — those are
   * person-scoped and handled by `forceDeletePersonInEvent`.
   */
  async forceDeleteRegistration(registrationId: string): Promise<void> {
    const { data: reg, error: regErr } = await this.supabase.service
      .from('registrations')
      .select('id, person_id, tournament_id, tournaments(id, name, event_id)')
      .eq('id', registrationId)
      .maybeSingle();
    if (regErr) throw new BadRequestException(regErr.message);
    if (!reg) throw new NotFoundException(`Registration ${registrationId} not found`);
    const r = reg as unknown as {
      id: string;
      person_id: string;
      tournament_id: string;
      tournaments: Embed<{ id: string; name: string; event_id: string }>;
    };
    const eventId = firstEmbed(r.tournaments)?.event_id;
    if (!eventId) throw new BadRequestException('Registration is not linked to an event');

    const report = await this.getEventAssignments(eventId, r.person_id, r.tournament_id);
    if (report.hasBlockingMatch) {
      throw new ConflictException({
        message: `Cannot force-delete registration ${registrationId}: blocking matches in status ${report.blockingMatches
          .map((m) => `${m.label || m.matchId} (${m.status})`)
          .join(', ')}.`,
        blockingMatches: report.blockingMatches,
      });
    }

    // Unplayed matches that reference this registration must be removed
    // before the FK RESTRICT on matches.{red,blue}_registration_id lets
    // the registration delete go through.
    const unplayedMatchIds = report.matchesAsFighter
      .map((m) => m.matchId)
      .filter(Boolean) as string[];
    if (unplayedMatchIds.length > 0) {
      const { error: delMatchesErr } = await this.supabase.service
        .from('matches')
        .delete()
        .in('id', unplayedMatchIds);
      if (delMatchesErr) throw new BadRequestException(delMatchesErr.message);
    }

    const { error: delRegErr } = await this.supabase.service
      .from('registrations')
      .delete()
      .eq('id', registrationId);
    if (delRegErr) throw new BadRequestException(delRegErr.message);
  }

  /**
   * Force-delete a person from a specific event:
   *
   *   1. Probe the event-scoped assignment graph; refuse with 409 if
   *      any blocking match exists (fighter or referee).
   *   2. Force-delete each of the person's registrations in the event
   *      (Slice B logic — deletes their unplayed matches, then the
   *      registration; pool_members cascade, bracket_slots null out).
   *   3. Remove the person's referee assignments scoped to this event
   *      (both `referee_assignments` rows AND legacy
   *      `matches.referee_id` references in the same event).
   *   4. Delete the person row.
   *
   * The person's other events (if any) are not touched.
   */
  async forceDeletePersonInEvent(personId: string, eventId: string): Promise<void> {
    const report = await this.getEventAssignments(eventId, personId);
    if (report.hasBlockingMatch) {
      throw new ConflictException({
        message: `Cannot force-delete person ${personId} from event ${eventId}: blocking matches in status ${report.blockingMatches
          .map((m) => `${m.label || m.matchId} (${m.status})`)
          .join(', ')}.`,
        blockingMatches: report.blockingMatches,
      });
    }

    // Step 2 — force-delete every registration in this event.
    // matchesAsFighter is already the per-event scope (probe was eventId-scoped),
    // so we can derive the registration ids from the assignment graph.
    const { data: regRows, error: regErr } = await this.supabase.service
      .from('registrations')
      .select('id, tournament_id, tournaments!inner(id, name, event_id)')
      .eq('person_id', personId)
      .eq('tournaments.event_id', eventId);
    if (regErr) throw new BadRequestException(regErr.message);

    const regIds = (regRows ?? [])
      .map((r) => (r as { id: string }).id)
      .filter((id) => typeof id === 'string');

    // Delete this person's unplayed matches across the event in one
    // batch (the report's matchesAsFighter is already scoped + filtered
    // to non-blocking statuses).
    const unplayedMatchIds = report.matchesAsFighter
      .map((m) => m.matchId)
      .filter((id): id is string => typeof id === 'string');
    if (unplayedMatchIds.length > 0) {
      const { error: delMatchesErr } = await this.supabase.service
        .from('matches')
        .delete()
        .in('id', unplayedMatchIds);
      if (delMatchesErr) throw new BadRequestException(delMatchesErr.message);
    }

    if (regIds.length > 0) {
      const { error: delRegsErr } = await this.supabase.service
        .from('registrations')
        .delete()
        .in('id', regIds);
      if (delRegsErr) throw new BadRequestException(delRegsErr.message);
    }

    // Step 3 — referee cleanup. Two surfaces:
    //   a. referee_assignments rows for this person in this event.
    //      We just delete them by person id; the scope_type='match'
    //      assignments may reference now-deleted matches, that's fine.
    const refAssignmentIds = report.refereeAssignments
      .map((a) => a.assignmentId)
      .filter((id): id is string => typeof id === 'string');
    if (refAssignmentIds.length > 0) {
      const { error: delRaErr } = await this.supabase.service
        .from('referee_assignments')
        .delete()
        .in('id', refAssignmentIds);
      if (delRaErr) throw new BadRequestException(delRaErr.message);
    }

    //   b. Legacy `matches.referee_id` — null out for any match in this
    //      event that still points at this person. Matches in unplayed
    //      states may have been deleted in step 2; this catches any
    //      remaining historical row.
    const { error: nullRefErr } = await this.supabase.service
      .from('matches')
      .update({ referee_id: null })
      .eq('referee_id', personId);
    if (nullRefErr) throw new BadRequestException(nullRefErr.message);

    // Step 4 — delete the person.
    const { error: delPersonErr } = await this.supabase.service
      .from('persons')
      .delete()
      .eq('id', personId);
    if (delPersonErr) throw new BadRequestException(delPersonErr.message);
  }
}
