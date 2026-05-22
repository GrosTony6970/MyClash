import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  assignRefereesWithPools,
  type AssignmentResult,
  type RefereeAssignment,
  type RefereeCandidate,
  type RefereePoolSlot,
  type RefereeRole,
} from '@myclash/rulesets/dist/scheduling/index';
import { SupabaseService } from '../supabase/supabase.service';
import { SettingsService } from './settings.service';

export const REFEREE_ASSIGNMENT_ROLES: RefereeRole[] = [
  'arbitre_declarant',
  'arbitre_assesseur',
  'arbitre_table',
];

export interface AssignmentBoardCandidate {
  userId: string;
  personId: string | null;
  displayName: string;
  clubLabel: string | null;
  qualifications: Array<{ role: RefereeRole; rating: number | null }>;
  workload: number;
}

export interface AssignmentBoardPool {
  id: string;
  name: string;
  tournamentId: string;
  tournamentName: string;
  liceId: string | null;
  scheduledStart: string | null;
  scheduledEnd: string | null;
  members: Array<{
    registrationId: string;
    personId: string;
    personName: string;
    clubLabel: string | null;
  }>;
  matches: Array<{
    id: string;
    scheduledAt: string | null;
    liceId: string | null;
    redRegistrationId: string | null;
    blueRegistrationId: string | null;
  }>;
  roleSlots: Array<{
    role: RefereeRole;
    assignment: {
      id: string;
      userId: string;
      personId: string | null;
      displayName: string;
      status: string;
      autoAssigned: boolean;
    } | null;
    missingReasons: string[];
    candidates: {
      recommended: AssignmentBoardCandidate[];
      warning: Array<AssignmentBoardCandidate & { warnings: string[] }>;
      blocked: Array<AssignmentBoardCandidate & { reasons: string[] }>;
    };
  }>;
}

export interface AssignmentBoard {
  roles: RefereeRole[];
  pools: AssignmentBoardPool[];
  unscheduledPools: AssignmentBoardPool[];
  candidates: AssignmentBoardCandidate[];
  missingSlots: Array<{ poolId: string; poolName: string; role: RefereeRole; reasons: string[] }>;
  warnings: Array<{ poolId: string; poolName: string; role: RefereeRole; detail: string }>;
  locked: boolean;
  swapSuggestions: [];
}

export interface ManualAssignmentDto {
  poolId: string;
  role: RefereeRole;
  userId: string;
}

interface TournamentRow {
  id: string;
  name: string;
}

interface PhaseRow {
  id: string;
  tournament_id: string;
}

interface PoolMemberRow {
  registration_id: string;
  registrations?:
    | {
        id: string;
        person_id: string;
        persons?: {
          id: string;
          given_name: string | null;
          family_name: string | null;
          display_name?: string | null;
          club_id?: string | null;
          clubs?: { name: string | null } | Array<{ name: string | null }> | null;
        } | null;
      }
    | Array<{
        id: string;
        person_id: string;
        persons?: {
          id: string;
          given_name: string | null;
          family_name: string | null;
          display_name?: string | null;
          club_id?: string | null;
          clubs?: { name: string | null } | Array<{ name: string | null }> | null;
        } | null;
      }>
    | null;
}

interface MatchRow {
  id: string;
  scheduled_at: string | null;
  lice_id: string | null;
  red_registration_id: string | null;
  blue_registration_id: string | null;
}

interface PoolRow {
  id: string;
  phase_id: string;
  name: string;
  sort_order?: number;
  pool_members?: PoolMemberRow[];
  matches?: MatchRow[];
}

interface EventRefereeRow {
  user_id: string;
}

interface QualificationRow {
  user_id: string;
  role: string;
  rating: number | null;
}

interface PersonRow {
  id: string;
  claimed_by_user_id: string | null;
  given_name: string | null;
  family_name: string | null;
  display_name: string | null;
  club_id: string | null;
  clubs?: { name: string | null } | Array<{ name: string | null }> | null;
}

interface RegistrationRow {
  id: string;
  person_id: string;
  tournament_id: string;
}

interface RefereeAssignmentRow {
  id: string;
  user_id: string;
  pool_id: string | null;
  role: string | null;
  status: string;
  auto_assigned: boolean;
}

@Injectable()
export class AssignmentBoardService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly settings: SettingsService,
  ) {}

  async getBoard(eventId: string): Promise<AssignmentBoard> {
    const context = await this.loadContext(eventId);
    const preview = await this.previewFromContext(context);
    return this.buildBoard(context, preview);
  }

  async preview(eventId: string): Promise<AssignmentResult & { swapSuggestions: [] }> {
    const context = await this.loadContext(eventId);
    const result = await this.previewFromContext(context);
    return { ...result, swapSuggestions: [] };
  }

  async applyPreview(eventId: string): Promise<AssignmentResult & { persisted: number }> {
    const context = await this.loadContext(eventId);
    const result = await this.previewFromContext(context);
    await this.persistAssignments(eventId, context, result.assignments, true);
    return { ...result, persisted: result.assignments.length };
  }

  async applyManual(eventId: string, dto: ManualAssignmentDto) {
    if (!REFEREE_ASSIGNMENT_ROLES.includes(dto.role)) {
      throw new BadRequestException(`Invalid referee role: ${dto.role}`);
    }

    const context = await this.loadContext(eventId);
    const pool = context.pools.find((p) => p.id === dto.poolId);
    if (!pool) throw new NotFoundException(`Pool ${dto.poolId} not found for event ${eventId}`);

    const candidate = context.candidates.find((c) => c.userId === dto.userId);
    if (!candidate) throw new BadRequestException('Selected user is not an event referee');

    const poolMembers = new Set(pool.members.map((m) => m.personId));
    if (candidate.personId && poolMembers.has(candidate.personId)) {
      throw new BadRequestException('A fighter cannot referee their own pool');
    }

    if (!candidate.qualifications.some((q) => q.role === dto.role)) {
      throw new BadRequestException('Selected referee is not qualified for this role');
    }

    await this.persistAssignments(
      eventId,
      context,
      [
        {
          poolId: dto.poolId,
          poolName: pool.name,
          role: dto.role,
          personId: candidate.personId ?? candidate.userId,
          personName: candidate.displayName,
          autoAssigned: true,
        },
      ],
      false,
    );

    return this.getBoard(eventId);
  }

  private async loadContext(eventId: string) {
    const tournaments = await this.listTournaments(eventId);
    if (tournaments.length === 0) {
      return {
        eventId,
        tournaments,
        phases: [] as PhaseRow[],
        pools: [] as AssignmentBoardPool[],
        candidates: [] as AssignmentBoardCandidate[],
        assignments: [] as RefereeAssignmentRow[],
        fighterRegistrationIdsByPerson: new Map<string, string[]>(),
        locked: false,
      };
    }

    const tournamentIds = tournaments.map((t) => t.id);
    const phases = await this.listPhases(tournamentIds);
    const phaseToTournament = new Map(phases.map((p) => [p.id, p.tournament_id]));
    const tournamentById = new Map(tournaments.map((t) => [t.id, t]));
    const pools = await this.listPools(
      phases.map((p) => p.id),
      phaseToTournament,
      tournamentById,
    );
    const candidates = await this.listCandidates(eventId);
    const registrations = await this.listRegistrations(tournamentIds);
    const fighterRegistrationIdsByPerson = new Map<string, string[]>();
    for (const registration of registrations) {
      const existing = fighterRegistrationIdsByPerson.get(registration.person_id) ?? [];
      existing.push(registration.id);
      fighterRegistrationIdsByPerson.set(registration.person_id, existing);
    }
    const assignments = await this.listAssignments(eventId);

    return {
      eventId,
      tournaments,
      phases,
      pools,
      candidates,
      assignments,
      fighterRegistrationIdsByPerson,
      locked: assignments.some((a) => a.status === 'confirmed'),
    };
  }

  private async listTournaments(eventId: string): Promise<TournamentRow[]> {
    const { data, error } = await this.supabase.service
      .from('tournaments')
      .select('id, name')
      .eq('event_id', eventId)
      .order('sort_order', { ascending: true });
    if (error) throw new BadRequestException(error.message);
    return (data ?? []) as TournamentRow[];
  }

  private async listPhases(tournamentIds: string[]): Promise<PhaseRow[]> {
    if (tournamentIds.length === 0) return [];
    const { data, error } = await this.supabase.service
      .from('phases')
      .select('id, tournament_id')
      .in('tournament_id', tournamentIds)
      .eq('type', 'pool');
    if (error) throw new BadRequestException(error.message);
    return (data ?? []) as PhaseRow[];
  }

  private async listPools(
    phaseIds: string[],
    phaseToTournament: Map<string, string>,
    tournamentById: Map<string, TournamentRow>,
  ): Promise<AssignmentBoardPool[]> {
    if (phaseIds.length === 0) return [];
    const { data, error } = await this.supabase.service
      .from('pools')
      .select(
        'id, phase_id, name, sort_order, pool_members(registration_id, registrations(id, person_id, persons(id, given_name, family_name, display_name, club_id, clubs(name)))), matches(id, scheduled_at, lice_id, red_registration_id, blue_registration_id)',
      )
      .in('phase_id', phaseIds)
      .order('sort_order', { ascending: true });
    if (error) throw new BadRequestException(error.message);

    return ((data ?? []) as unknown as PoolRow[]).map((pool) => {
      const matches = pool.matches ?? [];
      const scheduledTimes = matches
        .map((match) => match.scheduled_at)
        .filter((value): value is string => Boolean(value))
        .sort();
      const phaseTournamentId = phaseToTournament.get(pool.phase_id);
      const tournament = phaseTournamentId ? tournamentById.get(phaseTournamentId) : undefined;
      const scheduledEnd = scheduledTimes.length
        ? new Date(
            new Date(scheduledTimes[scheduledTimes.length - 1]!).getTime() + 5 * 60_000,
          ).toISOString()
        : null;
      const liceId = matches.find((m) => m.lice_id)?.lice_id ?? null;

      return {
        id: pool.id,
        name: pool.name,
        tournamentId: tournament?.id ?? '',
        tournamentName: tournament?.name ?? '',
        liceId,
        scheduledStart: scheduledTimes[0] ?? null,
        scheduledEnd,
        members: (pool.pool_members ?? []).map((member) => {
          const registration = this.firstRelation(member.registrations);
          const person = this.firstRelation(registration?.persons);
          const club = this.firstRelation(person?.clubs);
          return {
            registrationId: member.registration_id,
            personId: registration?.person_id ?? '',
            personName: this.formatName(person),
            clubLabel: club?.name ?? null,
          };
        }),
        matches: matches.map((match) => ({
          id: match.id,
          scheduledAt: match.scheduled_at,
          liceId: match.lice_id,
          redRegistrationId: match.red_registration_id,
          blueRegistrationId: match.blue_registration_id,
        })),
        roleSlots: [],
      };
    });
  }

  private async listCandidates(eventId: string): Promise<AssignmentBoardCandidate[]> {
    const { data: refRows, error: refError } = await this.supabase.service
      .from('event_referees')
      .select('user_id')
      .eq('event_id', eventId);
    if (refError) throw new BadRequestException(refError.message);
    const eventReferees = (refRows ?? []) as EventRefereeRow[];
    if (eventReferees.length === 0) return [];

    const userIds = eventReferees.map((r) => r.user_id);
    const { data: qualRows, error: qualError } = await this.supabase.service
      .from('referee_qualifications')
      .select('user_id, role, rating')
      .eq('event_id', eventId)
      .eq('active', true)
      .in('user_id', userIds);
    if (qualError) throw new BadRequestException(qualError.message);

    const qualificationsByUser = new Map<
      string,
      Array<{ role: RefereeRole; rating: number | null }>
    >();
    for (const q of (qualRows ?? []) as QualificationRow[]) {
      if (!REFEREE_ASSIGNMENT_ROLES.includes(q.role as RefereeRole)) continue;
      const list = qualificationsByUser.get(q.user_id) ?? [];
      list.push({ role: q.role as RefereeRole, rating: q.rating ?? null });
      qualificationsByUser.set(q.user_id, list);
    }

    const { data: personRows, error: personError } = await this.supabase.service
      .from('persons')
      .select('id, claimed_by_user_id, given_name, family_name, display_name, club_id, clubs(name)')
      .eq('event_id', eventId)
      .in('claimed_by_user_id', userIds);
    if (personError) throw new BadRequestException(personError.message);
    const personByUser = new Map<string, PersonRow>();
    for (const person of (personRows ?? []) as unknown as PersonRow[]) {
      if (person.claimed_by_user_id) personByUser.set(person.claimed_by_user_id, person);
    }

    return eventReferees.map((referee) => {
      const person = personByUser.get(referee.user_id);
      return {
        userId: referee.user_id,
        personId: person?.id ?? null,
        displayName: this.formatName(person) || referee.user_id,
        clubLabel: this.firstRelation(person?.clubs)?.name ?? null,
        qualifications: qualificationsByUser.get(referee.user_id) ?? [],
        workload: 0,
      };
    });
  }

  private async listRegistrations(tournamentIds: string[]): Promise<RegistrationRow[]> {
    if (tournamentIds.length === 0) return [];
    const { data, error } = await this.supabase.service
      .from('registrations')
      .select('id, person_id, tournament_id')
      .in('tournament_id', tournamentIds)
      .in('status', ['registered', 'checked_in']);
    if (error) throw new BadRequestException(error.message);
    return (data ?? []) as RegistrationRow[];
  }

  private async listAssignments(eventId: string): Promise<RefereeAssignmentRow[]> {
    const { data, error } = await this.supabase.service
      .from('referee_assignments')
      .select('id, user_id, pool_id, role, status, auto_assigned')
      .eq('event_id', eventId)
      .eq('scope_type', 'pool');
    if (error) throw new BadRequestException(error.message);
    return (data ?? []) as RefereeAssignmentRow[];
  }

  private async previewFromContext(
    context: Awaited<ReturnType<AssignmentBoardService['loadContext']>>,
  ) {
    const poolSlots: RefereePoolSlot[] = context.pools.map((pool) => ({
      poolId: pool.id,
      poolName: pool.name,
      earliestStart: pool.scheduledStart,
      latestEnd: pool.scheduledEnd,
      matches: pool.matches.map((match) => ({
        id: match.id,
        scheduledAt: match.scheduledAt,
        durationMinutes: 5,
        redRegistrationId: match.redRegistrationId ?? '',
        blueRegistrationId: match.blueRegistrationId ?? '',
      })),
    }));

    const engineCandidates: RefereeCandidate[] = context.candidates.map((candidate) => ({
      personId: candidate.personId ?? candidate.userId,
      personName: candidate.displayName,
      qualifications: candidate.qualifications,
      fighterRegistrationIds: candidate.personId
        ? (context.fighterRegistrationIdsByPerson.get(candidate.personId) ?? [])
        : [],
      workshopWindows: [],
    }));

    const poolSettings = await this.settings.getSettings(context.eventId);
    return assignRefereesWithPools(poolSlots, engineCandidates, {
      enforceRefereeNoBackToBack: poolSettings.enforceRefereeNoBackToBack,
      refereeRestMinSlots: poolSettings.refereeRestMinSlots,
      enforceDedicatedRefereeRest: poolSettings.enforceDedicatedRefereeRest,
      workshopConflictWarning: poolSettings.workshopConflictWarning,
      ratingBasedOrdering: poolSettings.ratingBasedOrdering,
      workloadBalance: poolSettings.workloadBalance,
    });
  }

  private buildBoard(
    context: Awaited<ReturnType<AssignmentBoardService['loadContext']>>,
    preview: AssignmentResult,
  ): AssignmentBoard {
    const candidateByEngineId = new Map(
      context.candidates.map((candidate) => [candidate.personId ?? candidate.userId, candidate]),
    );
    const candidateByUserId = new Map(
      context.candidates.map((candidate) => [candidate.userId, candidate]),
    );
    const assignmentByPoolRole = new Map<string, RefereeAssignmentRow>();
    for (const assignment of context.assignments) {
      if (!assignment.pool_id || !assignment.role) continue;
      assignmentByPoolRole.set(`${assignment.pool_id}:${assignment.role}`, assignment);
    }
    const previewAssignmentByPoolRole = new Map<string, RefereeAssignment>();
    for (const assignment of preview.assignments) {
      previewAssignmentByPoolRole.set(`${assignment.poolId}:${assignment.role}`, assignment);
    }
    const missingByPoolRole = new Map<string, string[]>();
    for (const missing of preview.missing) {
      missingByPoolRole.set(`${missing.poolId}:${missing.role}`, missing.rejectionReasons);
    }

    const pools = context.pools.map((pool) => {
      const poolMembers = new Set(pool.members.map((member) => member.personId));
      return {
        ...pool,
        roleSlots: REFEREE_ASSIGNMENT_ROLES.map((role) => {
          const persisted = assignmentByPoolRole.get(`${pool.id}:${role}`);
          const previewAssignment = previewAssignmentByPoolRole.get(`${pool.id}:${role}`);
          const assignedCandidate = persisted
            ? candidateByUserId.get(persisted.user_id)
            : previewAssignment
              ? candidateByEngineId.get(previewAssignment.personId)
              : undefined;

          const recommended: AssignmentBoardCandidate[] = [];
          const warning: Array<AssignmentBoardCandidate & { warnings: string[] }> = [];
          const blocked: Array<AssignmentBoardCandidate & { reasons: string[] }> = [];

          for (const candidate of context.candidates) {
            const reasons: string[] = [];
            if (!candidate.qualifications.some((q) => q.role === role))
              reasons.push('missing_qualification');
            if (candidate.personId && poolMembers.has(candidate.personId)) {
              reasons.push('fighter_referee_overlap');
            }
            if (reasons.length > 0) {
              blocked.push({ ...candidate, reasons });
            } else {
              recommended.push(candidate);
            }
          }

          return {
            role,
            assignment:
              assignedCandidate && (persisted || previewAssignment)
                ? {
                    id: persisted?.id ?? `${pool.id}:${role}:preview`,
                    userId: assignedCandidate.userId,
                    personId: assignedCandidate.personId,
                    displayName: assignedCandidate.displayName,
                    status: persisted?.status ?? 'preview',
                    autoAssigned: persisted?.auto_assigned ?? true,
                  }
                : null,
            missingReasons: missingByPoolRole.get(`${pool.id}:${role}`) ?? [],
            candidates: { recommended, warning, blocked },
          };
        }),
      };
    });

    return {
      roles: REFEREE_ASSIGNMENT_ROLES,
      pools: pools.filter((pool) => pool.scheduledStart !== null),
      unscheduledPools: pools.filter((pool) => pool.scheduledStart === null),
      candidates: context.candidates,
      missingSlots: preview.missing.map((missing) => ({
        poolId: missing.poolId,
        poolName: missing.poolName,
        role: missing.role,
        reasons: missing.rejectionReasons,
      })),
      warnings: preview.warnings.map((warning) => ({
        poolId: warning.poolId,
        poolName: warning.poolName,
        role: warning.role,
        detail: warning.detail,
      })),
      locked: context.locked,
      swapSuggestions: [],
    };
  }

  private async persistAssignments(
    eventId: string,
    context: Awaited<ReturnType<AssignmentBoardService['loadContext']>>,
    assignments: RefereeAssignment[],
    replaceAutoAssigned: boolean,
  ) {
    if (replaceAutoAssigned) {
      await this.supabase.service
        .from('referee_assignments')
        .delete()
        .eq('event_id', eventId)
        .eq('auto_assigned', true);
    }

    const candidateByEngineId = new Map(
      context.candidates.map((candidate) => [candidate.personId ?? candidate.userId, candidate]),
    );
    const rows = assignments
      .map((assignment) => {
        const candidate = candidateByEngineId.get(assignment.personId);
        const pool = context.pools.find((p) => p.id === assignment.poolId);
        if (!candidate || !pool) return null;
        return {
          event_id: eventId,
          user_id: candidate.userId,
          scope_type: 'pool',
          pool_id: assignment.poolId,
          lice_id: pool.liceId,
          role: assignment.role,
          starts_at: pool.scheduledStart,
          ends_at: pool.scheduledEnd,
          auto_assigned: replaceAutoAssigned,
          status: 'assigned',
          conflicts_jsonb: [],
        };
      })
      .filter((row): row is NonNullable<typeof row> => row !== null);

    if (rows.length === 0) return;

    if (!replaceAutoAssigned && rows.length === 1) {
      const row = rows[0]!;
      await this.supabase.service
        .from('referee_assignments')
        .delete()
        .eq('event_id', eventId)
        .eq('scope_type', 'pool')
        .eq('pool_id', row.pool_id)
        .eq('role', row.role);
    }

    const { error } = await this.supabase.service.from('referee_assignments').insert(rows);
    if (error) throw new BadRequestException(error.message);
  }

  private firstRelation<T>(value: T | T[] | null | undefined): T | null {
    if (Array.isArray(value)) return value[0] ?? null;
    return value ?? null;
  }

  private formatName(
    person?: {
      given_name?: string | null;
      family_name?: string | null;
      display_name?: string | null;
    } | null,
  ) {
    if (!person) return '';
    const name = `${person.given_name ?? ''} ${person.family_name ?? ''}`.trim();
    return name || person.display_name || '';
  }
}
