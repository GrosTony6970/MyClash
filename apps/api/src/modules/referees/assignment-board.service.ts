import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  assignRefereesWithPools,
  type AssignmentResult,
  type RefereeAssignment,
  type RefereeCandidate,
  type RefereePoolSlot,
  type RefereeRole,
} from '@myclash/rulesets/dist/scheduling/index';
import { formatRoundCode } from '@myclash/types';
import { SupabaseService } from '../supabase/supabase.service';
import { SettingsService } from './settings.service';
import { StaffingService, type ResolvedConfig } from './staffing.service';
import { buildFightersByPool } from './fighter-pool-membership';

/**
 * The three legacy skill IDs. R3 made the engine accept any skill_id, so
 * this constant is no longer used to filter candidates — but it stays
 * exported because other modules (and a future migration path) reference
 * the legacy default. New code should call `StaffingService.getResolvedConfig`
 * for the authoritative slot list.
 */
export const REFEREE_ASSIGNMENT_ROLES: RefereeRole[] = [
  'arbitre_declarant',
  'arbitre_assesseur',
  'arbitre_table',
];

/**
 * Empty engine result. Passed to `buildBoard()` whenever we want a
 * persisted-only view — the per-slot merge falls back to `persisted`
 * when `previewAssignment` is missing, so a fully-empty preview
 * yields a board with no proposed chips at all.
 */
const EMPTY_PREVIEW: AssignmentResult = {
  assignments: [],
  missing: [],
  warnings: [],
  swapSuggestions: [],
};

/**
 * `role` here is a `referee_skills.id` string — used to be the legacy
 * `RefereeRole` enum, loosened in R2 of the staffing overhaul so the
 * board can carry custom skills introduced via the Staffing tab.
 *
 * Post-0063: `personId` is the canonical identity (= global_persons.id).
 * `userId` is a derived display value (the auth UUID from
 * global_persons.claimed_by_user_id, or null if unclaimed) so frontends can
 * still show "this referee's auth email" — but it is never used for keying.
 */
export interface AssignmentBoardCandidate {
  personId: string;
  userId: string | null;
  displayName: string;
  clubLabel: string | null;
  qualifications: Array<{ role: string; rating: number | null }>;
  workload: number;
  /** Slice 8: per-tournament allowlist read from event_referee_tournaments. */
  availableTournamentIds?: string[];
  /** Slice 8: per-day allowlist read from event_referee_days. */
  availableDayIndices?: number[];
}

export interface AssignmentBoardPool {
  id: string;
  name: string;
  tournamentId: string;
  tournamentName: string;
  liceId: string | null;
  scheduledStart: string | null;
  scheduledEnd: string | null;
  /**
   * R4: phase-type kind. 'pool' for real pools (the pre-R4 default);
   * 'bracket' / 'finals' for individual bracket matches modelled as
   * single-match pools. The frontend groups by this field to split
   * assignment tables into Pool / Bracket / Finals sub-sections.
   */
  kind?: 'pool' | 'bracket' | 'finals';
  /**
   * R4: when kind is 'bracket' or 'finals', this is the match_id the
   * synthetic pool wraps. Used by manual assignments to record
   * scope_type='match' instead of scope_type='pool'.
   */
  matchId?: string;
  /**
   * Bracket-only metadata so the frontend can render readable round
   * labels ('Quarter-final #2') instead of the raw 'R{N}P{M}' string.
   * All three undefined for pool-kind rows. Computed once in
   * loadBracketAsPools from already-fetched bracket_slot info.
   */
  bracketRound?: number;
  bracketPosition?: number;
  bracketMaxRound?: number;
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
  /**
   * One entry per slot in the tournament's resolved `pool` config.
   * `role` is the primary skill id (= allowedSkillIds[0]) and is
   * retained for backwards compatibility with the legacy frontend;
   * new code should read `allowedSkillIds[]` and `slotIndex`.
   */
  roleSlots: Array<{
    slotIndex: number;
    displayName: string | null;
    allowedSkillIds: string[];
    role: string;
    assignment: {
      id: string;
      /** R6: claimed referees expose user_id; unclaimed expose person_id only. */
      userId: string | null;
      personId: string | null;
      displayName: string;
      status: string;
      autoAssigned: boolean;
      /**
       * True when the chip came from the auto-assign engine but is
       * not yet persisted — i.e. it lives only in the current
       * preview. Frontend renders these with a dashed "Proposed"
       * style so the operator can tell what's saved at a glance.
       */
      isProposal: boolean;
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
  /** Deduped union of skill_ids used across every pool's slots. */
  roles: string[];
  pools: AssignmentBoardPool[];
  unscheduledPools: AssignmentBoardPool[];
  candidates: AssignmentBoardCandidate[];
  missingSlots: Array<{ poolId: string; poolName: string; role: string; reasons: string[] }>;
  warnings: Array<{ poolId: string; poolName: string; role: string; detail: string }>;
  locked: boolean;
  /** R4: back-to-back swap suggestions surfaced to the operator. */
  swapSuggestions: Array<{
    fromPoolId: string;
    fromSlotIndex: number;
    fromPersonId: string;
    fromPersonName: string;
    toPersonId: string;
    toPersonName: string;
    reason: 'breaks_back_to_back';
    detail: string;
  }>;
}

export interface ManualAssignmentDto {
  poolId: string;
  /** Must be one of the pool's resolved slot's `allowedSkillIds`. */
  role: string;
  /** Post-0063: the canonical referee identity (= global_persons.id). */
  personId: string;
}

interface TournamentRow {
  id: string;
  name: string;
  weapon: string | null;
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
  person_id: string;
}

interface QualificationRow {
  person_id: string;
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
  /** Post-0063: person_id is the only identity column. */
  person_id: string;
  pool_id: string | null;
  /** R4: bracket-scoped assignments use match_id instead of pool_id. */
  match_id: string | null;
  role: string | null;
  status: string;
  auto_assigned: boolean;
}

@Injectable()
export class AssignmentBoardService {
  private readonly logger = new Logger(AssignmentBoardService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly settings: SettingsService,
    private readonly staffing: StaffingService,
  ) {}

  /**
   * Persisted-only board. The auto-assign engine is NOT run here —
   * proposals only appear after the operator explicitly clicks
   * "Preview auto assign", which routes through `previewBoard()`.
   * This is the on-mount entry point for the Assignments tab.
   */
  async getBoard(eventId: string): Promise<AssignmentBoard> {
    const context = await this.loadContext(eventId);
    return this.buildBoard(context, EMPTY_PREVIEW);
  }

  /**
   * Same shape as `getBoard()` but with the auto-assign engine
   * proposals overlaid. Slots that get a chip from the engine (with
   * no matching persisted row) carry `assignment.isProposal: true`
   * so the UI can render them distinctly.
   */
  async previewBoard(eventId: string): Promise<AssignmentBoard> {
    const context = await this.loadContext(eventId);
    const preview = await this.previewFromContext(context);
    return this.buildBoard(context, preview);
  }

  async preview(eventId: string): Promise<AssignmentResult & { swapSuggestions: [] }> {
    const context = await this.loadContext(eventId);
    const result = await this.previewFromContext(context);
    return { ...result, swapSuggestions: [] };
  }

  /**
   * Distinct referee roles a per-match referee column should render
   * for this tournament. Source of truth is the resolved staffing
   * config — `pool[].allowedSkillIds` covers both system skills
   * (arbitre_declarant / assesseur / table) and any custom skills
   * the event configured. We dedupe across slots, then look up
   * `referee_skills.name` for the human-readable column header.
   * Roles preserve the slot order they appeared in.
   */
  async getPoolMatchRoleConfig(
    tournamentId: string,
  ): Promise<{ roles: Array<{ id: string; displayName: string }> }> {
    const config = await this.staffing.getResolvedConfigForAssignmentBoard(tournamentId);

    const orderedDistinct: string[] = [];
    const seen = new Set<string>();
    for (const slot of config.pool) {
      for (const skillId of slot.allowedSkillIds) {
        if (seen.has(skillId)) continue;
        seen.add(skillId);
        orderedDistinct.push(skillId);
      }
    }

    if (orderedDistinct.length === 0) return { roles: [] };

    const { data: skills } = await this.supabase.service
      .from('referee_skills')
      .select('id, name')
      .in('id', orderedDistinct);

    const nameById = new Map<string, string>(
      ((skills ?? []) as Array<{ id: string; name: string }>).map((s) => [s.id, s.name]),
    );

    return {
      roles: orderedDistinct.map((id) => ({ id, displayName: nameById.get(id) ?? id })),
    };
  }

  /**
   * Bulk-clear every referee assignment for an event. Feeds the
   * "Clear all" button on the Assignments tab. Refuses to run when
   * any row is `status='confirmed'` — operator must Unlock first
   * (otherwise we'd silently wipe a locked board).
   */
  async clearEventAssignments(eventId: string): Promise<{ deleted: number }> {
    const { data, error } = await this.supabase.service
      .from('referee_assignments')
      .select('id, status')
      .eq('event_id', eventId);
    if (error) throw new BadRequestException(error.message);
    const rows = (data ?? []) as Array<{ id: string; status: string }>;
    if (rows.some((r) => r.status === 'confirmed')) {
      throw new ConflictException('Assignments are locked. Unlock the board before clearing.');
    }
    if (rows.length === 0) return { deleted: 0 };
    const { error: delErr } = await this.supabase.service
      .from('referee_assignments')
      .delete()
      .eq('event_id', eventId);
    if (delErr) throw new BadRequestException(delErr.message);
    return { deleted: rows.length };
  }

  /**
   * Bulk-clear every referee assignment for one pool. Wipes BOTH
   * `scope_type='pool'` rows for the pool AND `scope_type='match'`
   * rows for every match in the pool. Same lock guard as
   * `clearEventAssignments`.
   */
  async clearPoolAssignments(poolId: string): Promise<{ deleted: number }> {
    const { data: matches, error: matchesErr } = await this.supabase.service
      .from('matches')
      .select('id')
      .eq('pool_id', poolId);
    if (matchesErr) throw new BadRequestException(matchesErr.message);
    const matchIds = ((matches ?? []) as Array<{ id: string }>).map((m) => m.id);

    const { data: poolRows, error: poolErr } = await this.supabase.service
      .from('referee_assignments')
      .select('id, status')
      .eq('scope_type', 'pool')
      .eq('pool_id', poolId);
    if (poolErr) throw new BadRequestException(poolErr.message);

    let matchRows: Array<{ id: string; status: string }> = [];
    if (matchIds.length > 0) {
      const { data: m, error: mErr } = await this.supabase.service
        .from('referee_assignments')
        .select('id, status')
        .eq('scope_type', 'match')
        .in('match_id', matchIds);
      if (mErr) throw new BadRequestException(mErr.message);
      matchRows = (m ?? []) as Array<{ id: string; status: string }>;
    }

    const all = [...((poolRows ?? []) as Array<{ id: string; status: string }>), ...matchRows];
    if (all.some((r) => r.status === 'confirmed')) {
      throw new ConflictException('Assignments are locked. Unlock the board before clearing.');
    }
    if (all.length === 0) return { deleted: 0 };
    const { error: delErr } = await this.supabase.service
      .from('referee_assignments')
      .delete()
      .in(
        'id',
        all.map((r) => r.id),
      );
    if (delErr) throw new BadRequestException(delErr.message);
    return { deleted: all.length };
  }

  async applyPreview(eventId: string): Promise<AssignmentResult & { persisted: number }> {
    const context = await this.loadContext(eventId);
    const result = await this.previewFromContext(context);
    await this.persistAssignments(eventId, context, result.assignments, true);
    return { ...result, persisted: result.assignments.length };
  }

  async applyManual(eventId: string, dto: ManualAssignmentDto) {
    const context = await this.loadContext(eventId);
    const pool = context.pools.find((p) => p.id === dto.poolId);
    if (!pool) throw new NotFoundException(`Pool ${dto.poolId} not found for event ${eventId}`);

    // R2 + R4: the role must be in the resolved slot config's allowed
    // skills for this pool's tournament, picking the right slice
    // (pool / bracket / finals) based on the pool's R4 `kind`. The
    // hard-coded floor (Décl / Asses / Table) still passes when no
    // Staffing rows exist, so legacy requests keep working unchanged.
    const config = context.slotConfigByTournament.get(pool.tournamentId);
    const kind = pool.kind ?? 'pool';
    const sourceSlots =
      kind === 'finals'
        ? (config?.finals ?? [])
        : kind === 'bracket'
          ? (config?.bracket ?? [])
          : (config?.pool ?? []);
    const allowed = new Set<string>();
    for (const slot of sourceSlots) {
      for (const sid of slot.allowedSkillIds) allowed.add(sid);
    }
    if (!allowed.has(dto.role)) {
      throw new BadRequestException(
        `Role ${dto.role} is not allowed for this ${kind} under the current Staffing config`,
      );
    }

    if (!dto.personId) {
      throw new BadRequestException('personId is required');
    }
    const candidate = context.candidates.find((c) => c.personId === dto.personId);
    if (!candidate) throw new BadRequestException('Selected referee is not on this event roster');

    // Pool-membership check handles real pools (members list) and bracket
    // matches (red/blue registration IDs on the single match) uniformly.
    const poolMembers = new Set<string>(pool.members.map((m) => m.personId));
    const fighterRegIds = context.fighterRegistrationIdsByPerson.get(candidate.personId) ?? [];
    for (const match of pool.matches) {
      if (
        (match.redRegistrationId && fighterRegIds.includes(match.redRegistrationId)) ||
        (match.blueRegistrationId && fighterRegIds.includes(match.blueRegistrationId))
      ) {
        throw new BadRequestException('A fighter cannot referee their own match');
      }
    }
    if (poolMembers.has(candidate.personId)) {
      throw new BadRequestException('A fighter cannot referee their own pool');
    }

    if (!candidate.qualifications.some((q) => q.role === dto.role)) {
      throw new BadRequestException('Selected referee is not qualified for this role');
    }

    // Slice 7b: same person cannot hold two different roles on the same
    // pool / bracket match. The auto-assigner already enforces this via
    // `alreadyAssignedToPool` (referee-assigner.ts:449-461) — the manual
    // PATCH was the missing entry-point. Match by pool_id for real pools
    // and by match_id for the bracket / finals projections.
    const isMatchScoped = (pool.kind ?? 'pool') !== 'pool';
    const conflictingExisting = context.assignments.find((a) => {
      if (a.person_id !== candidate.personId || a.role === dto.role) return false;
      if (isMatchScoped) return a.match_id === pool.matchId;
      return a.pool_id === pool.id;
    });
    if (conflictingExisting) {
      throw new BadRequestException(
        'This referee is already assigned a different role in this pool',
      );
    }

    const slotIndex = sourceSlots.find((s) => s.allowedSkillIds.includes(dto.role))?.index ?? 1;

    await this.persistAssignments(
      eventId,
      context,
      [
        {
          poolId: dto.poolId,
          poolName: pool.name,
          slotIndex,
          role: dto.role as RefereeRole,
          personId: candidate.personId,
          personName: candidate.displayName,
          autoAssigned: true,
        },
      ],
      false,
    );

    return this.getBoard(eventId);
  }

  private async loadContext(eventId: string) {
    // Slice 8: event.start_date anchors dayIndex computation for the
    // per-day availability filter. Fetched up front so every pool can
    // resolve its own day index without re-querying.
    const { data: eventRow } = await this.supabase.service
      .from('events')
      .select('start_date')
      .eq('id', eventId)
      .maybeSingle();
    const eventStartDate = (eventRow as { start_date: string | null } | null)?.start_date ?? null;

    const tournaments = await this.listTournaments(eventId);
    if (tournaments.length === 0) {
      return {
        eventId,
        eventStartDate,
        tournaments,
        phases: [] as PhaseRow[],
        pools: [] as AssignmentBoardPool[],
        candidates: [] as AssignmentBoardCandidate[],
        assignments: [] as RefereeAssignmentRow[],
        fighterRegistrationIdsByPerson: new Map<string, string[]>(),
        slotConfigByTournament: new Map<string, ResolvedConfig>(),
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

    // R2: resolve the slot config once per tournament. We bypass the
    // staffing service's auth gate here — this code path is already
    // gated by the assignment-board controller's scorekeeper check, and
    // we don't have a user id at this depth without threading one in.
    // Reads only — no writes — and only against the tournament's own
    // event, so the bypass is bounded.
    const slotConfigByTournament = new Map<string, ResolvedConfig>();
    for (const tournament of tournaments) {
      const config = await this.staffing.getResolvedConfigForAssignmentBoard(tournament.id);
      slotConfigByTournament.set(tournament.id, config);
    }

    // R4: bracket matches (single_elim / double_elim phases). Each
    // bracket match becomes a synthetic single-match "pool" in the
    // engine pipeline so it gets the same slot-config + conflict
    // detection as real pools.
    const bracketPools = await this.loadBracketAsPools(tournamentIds, tournamentById);
    const allPools = [...pools, ...bracketPools];

    // Fighter source-of-truth: pool_members. listRegistrations above is
    // status-filtered ('registered'|'checked_in'), which silently drops
    // anyone whose registration row drifts to another state — leaving
    // the engine's hard fighter-conflict filter unable to see them and
    // letting them be auto-assigned as a referee on their own pool.
    // Merge every (personId, registrationId) pair from pool.members so
    // pool membership wins regardless of registration status.
    for (const pool of allPools) {
      for (const member of pool.members) {
        const existing = fighterRegistrationIdsByPerson.get(member.personId) ?? [];
        if (!existing.includes(member.registrationId)) {
          existing.push(member.registrationId);
          fighterRegistrationIdsByPerson.set(member.personId, existing);
        }
      }
    }

    return {
      eventId,
      eventStartDate,
      tournaments,
      phases,
      pools: allPools,
      candidates,
      assignments,
      fighterRegistrationIdsByPerson,
      slotConfigByTournament,
      locked: assignments.some((a) => a.status === 'confirmed'),
    };
  }

  /**
   * R4: load bracket matches as synthetic "pool of one match" entries.
   * `kind` and `matchId` on each entry let the rest of the pipeline
   * (engine slot config, board grouping, persistence) treat them
   * correctly without scattering bracket-specific code paths.
   *
   * `classifyBracketMatch` decides between 'bracket' and 'finals' based
   * on the match's round vs. the phase's max round (last round = final
   * + 3rd-place; round-before-last = semis). All three slot configs
   * (pool/bracket/finals) are resolved per tournament, so the synthetic
   * pool's downstream slot lookup falls through cleanly.
   */
  private async loadBracketAsPools(
    tournamentIds: string[],
    tournamentById: Map<string, TournamentRow>,
  ): Promise<AssignmentBoardPool[]> {
    if (tournamentIds.length === 0) return [];
    const { data: bracketPhases, error: phErr } = await this.supabase.service
      .from('phases')
      .select('id, tournament_id, type')
      .in('tournament_id', tournamentIds)
      .in('type', ['single_elim', 'double_elim']);
    if (phErr) throw new BadRequestException(phErr.message);
    const phases = (bracketPhases ?? []) as Array<{
      id: string;
      tournament_id: string;
      type: string;
    }>;
    if (phases.length === 0) return [];
    const phaseById = new Map(phases.map((p) => [p.id, p]));

    const { data: matches, error: mErr } = await this.supabase.service
      .from('matches')
      .select(
        'id, phase_id, scheduled_at, lice_id, red_registration_id, blue_registration_id, bracket_slot_id',
      )
      .in(
        'phase_id',
        phases.map((p) => p.id),
      );
    if (mErr) throw new BadRequestException(mErr.message);

    const matchRows = (matches ?? []) as Array<{
      id: string;
      phase_id: string;
      scheduled_at: string | null;
      lice_id: string | null;
      red_registration_id: string | null;
      blue_registration_id: string | null;
      bracket_slot_id: string | null;
    }>;
    if (matchRows.length === 0) return [];

    // Pull bracket_slots so we know each match's round/position. Match
    // round is what drives finals classification.
    const slotIds = Array.from(
      new Set(matchRows.map((m) => m.bracket_slot_id).filter((id): id is string => !!id)),
    );
    const slotInfo = new Map<string, { round: number; position: number; phaseId: string }>();
    if (slotIds.length > 0) {
      const { data: slots, error: slErr } = await this.supabase.service
        .from('bracket_slots')
        .select('id, phase_id, round, position')
        .in('id', slotIds);
      if (slErr) throw new BadRequestException(slErr.message);
      for (const r of (slots ?? []) as Array<{
        id: string;
        phase_id: string;
        round: number;
        position: number;
      }>) {
        slotInfo.set(r.id, { round: r.round, position: r.position, phaseId: r.phase_id });
      }
    }

    // Per-phase max round (needed to identify finals/semis).
    const maxRoundByPhase = new Map<string, number>();
    for (const m of matchRows) {
      const info = m.bracket_slot_id ? slotInfo.get(m.bracket_slot_id) : null;
      if (!info) continue;
      const current = maxRoundByPhase.get(info.phaseId) ?? 0;
      if (info.round > current) maxRoundByPhase.set(info.phaseId, info.round);
    }

    return matchRows.map((m) => {
      const phase = phaseById.get(m.phase_id);
      const tournament = phase ? tournamentById.get(phase.tournament_id) : undefined;
      const info = m.bracket_slot_id ? (slotInfo.get(m.bracket_slot_id) ?? null) : null;
      const maxRound = maxRoundByPhase.get(m.phase_id) ?? 0;
      const kind = AssignmentBoardService.classifyBracketMatchKind(info, maxRound);
      const scheduledEnd = m.scheduled_at
        ? new Date(new Date(m.scheduled_at).getTime() + 5 * 60_000).toISOString()
        : null;

      return {
        id: `match-${m.id}`,
        // Unified code via the shared formatRoundCode helper so the
        // bracket page, scoring app, scoreboard, and this referee
        // board all agree. Bracket rounds get the LSW-B-QF-M1 shape;
        // play-ins (round 0) get LSW-B-PI-M5. 2^maxRound derives a
        // bracketSize the helper uses for QF/SF/F/Rn naming.
        name: info
          ? formatRoundCode({
              weapon: tournament?.weapon ?? null,
              poolNumber: null,
              bracketRound: info.round,
              bracketSize: maxRound > 0 ? 2 ** maxRound : null,
              matchNumber: info.position,
            })
          : `Match ${m.id.slice(0, 6)}`,
        tournamentId: tournament?.id ?? '',
        tournamentName: tournament?.name ?? '',
        liceId: m.lice_id,
        scheduledStart: m.scheduled_at,
        scheduledEnd,
        kind,
        matchId: m.id,
        ...(info
          ? {
              bracketRound: info.round,
              bracketPosition: info.position,
              bracketMaxRound: maxRound,
            }
          : {}),
        members: [],
        matches: [
          {
            id: m.id,
            scheduledAt: m.scheduled_at,
            liceId: m.lice_id,
            redRegistrationId: m.red_registration_id,
            blueRegistrationId: m.blue_registration_id,
          },
        ],
        roleSlots: [],
      };
    });
  }

  /**
   * R4: medal-set detection.
   *   - Final match: round = maxRound, position = 1
   *   - 3rd-place (bronze) match: round = maxRound, position = 2 (if bronze is on)
   *   - Semifinals: round = maxRound - 1
   * Everything else in the bracket is 'bracket'. When we can't read the
   * slot info, default to 'bracket' so unknowns don't silently get the
   * heavier finals config.
   */
  static classifyBracketMatchKind(
    info: { round: number; position: number; phaseId: string } | null,
    maxRound: number,
  ): 'bracket' | 'finals' {
    if (!info || maxRound === 0) return 'bracket';
    if (info.round === maxRound) return 'finals'; // final + bronze share this round
    if (info.round === maxRound - 1) return 'finals'; // semis
    return 'bracket';
  }

  private async listTournaments(eventId: string): Promise<TournamentRow[]> {
    const { data, error } = await this.supabase.service
      .from('tournaments')
      .select('id, name, weapon')
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
        'id, phase_id, name, sort_order, pool_members(registration_id, registrations(id, person_id, persons(id, given_name, family_name, club_id, clubs(name)))), matches(id, scheduled_at, lice_id, red_registration_id, blue_registration_id)',
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
    // Post-0063: event_referees keys on person_id only. userId on the
    // returned candidate is a derived display field, resolved here once via
    // global_persons.claimed_by_user_id.
    const { data: refRows, error: refError } = await this.supabase.service
      .from('event_referees')
      .select('person_id')
      .eq('event_id', eventId);
    if (refError) throw new BadRequestException(refError.message);
    const eventReferees = (refRows ?? []) as EventRefereeRow[];
    if (eventReferees.length === 0) return [];

    const personIds = eventReferees.map((r) => r.person_id);

    const qualificationsByPerson = new Map<
      string,
      Array<{ role: string; rating: number | null }>
    >();
    const { data: qualRows, error: qualError } = await this.supabase.service
      .from('referee_qualifications')
      .select('person_id, role, rating')
      .eq('event_id', eventId)
      .eq('active', true)
      .in('person_id', personIds);
    if (qualError) throw new BadRequestException(qualError.message);
    for (const q of (qualRows ?? []) as QualificationRow[]) {
      const list = qualificationsByPerson.get(q.person_id) ?? [];
      list.push({ role: q.role, rating: q.rating ?? null });
      qualificationsByPerson.set(q.person_id, list);
    }

    const gpById = new Map<
      string,
      {
        id: string;
        claimed_by_user_id: string | null;
        given_name: string;
        family_name: string;
        club_id: string | null;
      }
    >();
    const { data: gpRows } = await this.supabase.service
      .from('global_persons')
      .select('id, claimed_by_user_id, given_name, family_name, club_id')
      .in('id', personIds);
    for (const gp of (gpRows ?? []) as Array<{
      id: string;
      claimed_by_user_id: string | null;
      given_name: string;
      family_name: string;
      club_id: string | null;
    }>) {
      gpById.set(gp.id, gp);
    }

    const clubIds = Array.from(
      new Set(
        Array.from(gpById.values())
          .map((gp) => gp.club_id)
          .filter((id): id is string => !!id),
      ),
    );
    let clubsById = new Map<string, string>();
    if (clubIds.length > 0) {
      const { data: clubsData } = await this.supabase.service
        .from('clubs')
        .select('id, name')
        .in('id', clubIds);
      clubsById = new Map(
        ((clubsData ?? []) as Array<{ id: string; name: string | null }>)
          .filter((c) => c.name !== null)
          .map((c) => [c.id, c.name as string]),
      );
    }

    // Slice 8: per-tournament + per-day allowlists.
    const tournamentsByPerson = new Map<string, string[]>();
    const daysByPerson = new Map<string, number[]>();
    const { data: tournRows } = await this.supabase.service
      .from('event_referee_tournaments')
      .select('person_id, tournament_id')
      .eq('event_id', eventId);
    for (const t of (tournRows ?? []) as Array<{ person_id: string; tournament_id: string }>) {
      const list = tournamentsByPerson.get(t.person_id) ?? [];
      list.push(t.tournament_id);
      tournamentsByPerson.set(t.person_id, list);
    }
    const { data: dayRows } = await this.supabase.service
      .from('event_referee_days')
      .select('person_id, day_index')
      .eq('event_id', eventId);
    for (const d of (dayRows ?? []) as Array<{ person_id: string; day_index: number }>) {
      const list = daysByPerson.get(d.person_id) ?? [];
      list.push(d.day_index);
      daysByPerson.set(d.person_id, list);
    }

    return eventReferees.map((referee): AssignmentBoardCandidate => {
      const gp = gpById.get(referee.person_id) ?? null;
      const name = gp
        ? `${gp.given_name} ${gp.family_name}`.trim() || referee.person_id
        : referee.person_id;
      const availableTournamentIds = tournamentsByPerson.get(referee.person_id);
      const availableDayIndices = daysByPerson.get(referee.person_id);
      return {
        personId: referee.person_id,
        userId: gp?.claimed_by_user_id ?? null,
        displayName: name,
        clubLabel: gp?.club_id ? (clubsById.get(gp.club_id) ?? null) : null,
        qualifications: qualificationsByPerson.get(referee.person_id) ?? [],
        workload: 0,
        ...(availableTournamentIds ? { availableTournamentIds } : {}),
        ...(availableDayIndices ? { availableDayIndices } : {}),
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
    // R4: include match-scoped (bracket) assignments alongside pool-scoped
    // ones. The board's roleSlot matcher looks them up by pool_id OR by
    // the synthetic match-id (via the pool's matchId field).
    const { data, error } = await this.supabase.service
      .from('referee_assignments')
      .select('id, person_id, pool_id, match_id, role, status, auto_assigned')
      .eq('event_id', eventId)
      .in('scope_type', ['pool', 'match']);
    if (error) throw new BadRequestException(error.message);
    return (data ?? []) as RefereeAssignmentRow[];
  }

  private async previewFromContext(
    context: Awaited<ReturnType<AssignmentBoardService['loadContext']>>,
  ) {
    // R3 + R4: feed the engine each pool's resolved slot list. The
    // `kind` field (added in R4) selects which slice of the resolved
    // config applies: 'pool' uses config.pool, 'bracket' uses
    // config.bracket, 'finals' uses config.finals. Pools whose
    // tournament has no Staffing config get `slotDefinitions: undefined`,
    // which makes the engine fall back to LEGACY_DEFAULT_SLOTS.
    const eventStartMs = context.eventStartDate
      ? new Date(`${context.eventStartDate}T00:00:00.000Z`).getTime()
      : null;
    const poolSlots: RefereePoolSlot[] = context.pools.map((pool) => {
      const config = context.slotConfigByTournament.get(pool.tournamentId);
      const kind = pool.kind ?? 'pool';
      const sourceSlots =
        kind === 'finals' ? config?.finals : kind === 'bracket' ? config?.bracket : config?.pool;
      const slotDefinitions = sourceSlots?.map((s) => ({
        index: s.index,
        displayName: s.displayName,
        allowedSkillIds: s.allowedSkillIds,
      }));
      // Slice 8: dayIndex floored from (poolStart - eventStart) / 86400000.
      // Pools with no scheduled start get no dayIndex — the engine then
      // skips the per-day filter for them.
      let dayIndex: number | undefined;
      if (eventStartMs !== null && pool.scheduledStart) {
        const poolMs = new Date(pool.scheduledStart).getTime();
        dayIndex = Math.max(0, Math.floor((poolMs - eventStartMs) / 86_400_000));
      }
      return {
        poolId: pool.id,
        poolName: pool.name,
        earliestStart: pool.scheduledStart,
        latestEnd: pool.scheduledEnd,
        tournamentId: pool.tournamentId,
        ...(dayIndex !== undefined ? { dayIndex } : {}),
        matches: pool.matches.map((match) => ({
          id: match.id,
          scheduledAt: match.scheduledAt,
          durationMinutes: 5,
          redRegistrationId: match.redRegistrationId ?? '',
          blueRegistrationId: match.blueRegistrationId ?? '',
        })),
        ...(slotDefinitions ? { slotDefinitions } : {}),
        ...(kind === 'finals' ? { isFinals: true } : {}),
      };
    });

    // R3: every qualification flows through to the engine — custom skill
    // IDs are first-class. The engine itself decides which slots a qual matches.
    const engineCandidates: RefereeCandidate[] = context.candidates.map(
      (candidate): RefereeCandidate => ({
        personId: candidate.personId,
        personName: candidate.displayName,
        qualifications: candidate.qualifications.map((q) => ({
          role: q.role as RefereeRole,
          rating: q.rating,
        })),
        fighterRegistrationIds:
          context.fighterRegistrationIdsByPerson.get(candidate.personId) ?? [],
        workshopWindows: [] as Array<{ start: string; end: string }>,
        ...(candidate.availableTournamentIds
          ? { availableTournamentIds: candidate.availableTournamentIds }
          : {}),
        ...(candidate.availableDayIndices
          ? { availableDayIndices: candidate.availableDayIndices }
          : {}),
      }),
    );

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
    // R6: candidates may have a null userId (unclaimed). The engine
    // keys on whichever id is set, so do the same here.
    // Post-0063: candidates + persisted rows + engine output all key on personId.
    const candidateByPersonId = new Map<string, AssignmentBoardCandidate>();
    for (const candidate of context.candidates) {
      candidateByPersonId.set(candidate.personId, candidate);
    }
    // R4: assignments can be either pool-scoped or match-scoped. We key
    // the lookup with a uniform string so the per-pool roleSlot matcher
    // doesn't care which scope produced it.
    //   - pool-scoped: `${pool_id}:${role}`
    //   - match-scoped: `match-${match_id}:${role}`
    const assignmentByPoolRole = new Map<string, RefereeAssignmentRow>();
    for (const assignment of context.assignments) {
      if (!assignment.role) continue;
      if (assignment.pool_id) {
        assignmentByPoolRole.set(`${assignment.pool_id}:${assignment.role}`, assignment);
      } else if (assignment.match_id) {
        assignmentByPoolRole.set(`match-${assignment.match_id}:${assignment.role}`, assignment);
      }
    }
    // R3: the engine's RefereeAssignment now carries `slotIndex`, so key
    // preview lookups by `${poolId}:${slotIndex}` instead of `:role`. A
    // multi-skill slot would otherwise collide with a sibling slot that
    // shares the same primary role.
    const previewAssignmentByPoolSlot = new Map<string, RefereeAssignment>();
    for (const assignment of preview.assignments) {
      previewAssignmentByPoolSlot.set(`${assignment.poolId}:${assignment.slotIndex}`, assignment);
    }
    const missingByPoolSlot = new Map<string, string[]>();
    for (const missing of preview.missing) {
      missingByPoolSlot.set(`${missing.poolId}:${missing.slotIndex}`, missing.rejectionReasons);
    }

    // R2 + R4: roleSlots come from the resolved Staffing config per
    // tournament, selecting `pool`/`bracket`/`finals` based on the
    // pool's R4 `kind`. The legacy 3-role default still kicks in when
    // no Staffing rows exist (HARD_CODED_DEFAULT_SLOTS in staffing.service).
    const pools = context.pools.map((pool) => {
      const poolMembers = new Set(pool.members.map((member) => member.personId));
      const slotConfig = context.slotConfigByTournament.get(pool.tournamentId);
      const kind = pool.kind ?? 'pool';
      const slots =
        kind === 'finals'
          ? (slotConfig?.finals ?? [])
          : kind === 'bracket'
            ? (slotConfig?.bracket ?? [])
            : (slotConfig?.pool ?? []);

      return {
        ...pool,
        roleSlots: slots.map((slot) => {
          const allowed = slot.allowedSkillIds;
          const primaryRole = allowed[0]!;

          // Match an existing assignment when its `role` is in the
          // slot's allowed set. Slots that share the same primary skill
          // would race for the same persisted row — we de-conflict by
          // slot_index when needed, but in practice slot configs use
          // distinct primary skills per slot.
          let persisted: RefereeAssignmentRow | undefined;
          for (const sid of allowed) {
            const found = assignmentByPoolRole.get(`${pool.id}:${sid}`);
            if (found) {
              persisted = found;
              break;
            }
          }
          // R3: preview lookup is now slot-indexed (not role-indexed) so
          // multi-skill slots resolve correctly even when several slots
          // share a primary role.
          const previewAssignment = previewAssignmentByPoolSlot.get(`${pool.id}:${slot.index}`);
          const assignedCandidate = persisted
            ? candidateByPersonId.get(persisted.person_id)
            : previewAssignment
              ? candidateByPersonId.get(previewAssignment.personId)
              : undefined;

          const allowedSet = new Set(allowed);
          const recommended: AssignmentBoardCandidate[] = [];
          const warning: Array<AssignmentBoardCandidate & { warnings: string[] }> = [];
          const blocked: Array<AssignmentBoardCandidate & { reasons: string[] }> = [];

          for (const candidate of context.candidates) {
            const reasons: string[] = [];
            const hasMatchingQual = candidate.qualifications.some((q) => allowedSet.has(q.role));
            if (!hasMatchingQual) reasons.push('missing_qualification');
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
            slotIndex: slot.index,
            displayName: slot.displayName,
            allowedSkillIds: allowed,
            role: primaryRole,
            assignment:
              assignedCandidate && (persisted || previewAssignment)
                ? {
                    id: persisted?.id ?? `${pool.id}:${primaryRole}:preview`,
                    userId: assignedCandidate.userId,
                    personId: assignedCandidate.personId,
                    displayName: assignedCandidate.displayName,
                    status: persisted?.status ?? 'preview',
                    autoAssigned: persisted?.auto_assigned ?? true,
                    // Proposal = engine output with no matching
                    // persisted row. The UI uses this to render
                    // dashed chips with a "Proposed" badge.
                    isProposal: !persisted,
                  }
                : null,
            missingReasons: missingByPoolSlot.get(`${pool.id}:${slot.index}`) ?? [],
            candidates: { recommended, warning, blocked },
          };
        }),
      };
    });

    // Dedup the skill_ids surfaced anywhere in this board so the
    // (legacy) `board.roles` field stays meaningful for callers that
    // haven't migrated to reading per-pool slots yet.
    const allRolesSet = new Set<string>();
    for (const pool of pools) {
      for (const slot of pool.roleSlots) {
        for (const sid of slot.allowedSkillIds) allRolesSet.add(sid);
      }
    }

    return {
      roles: Array.from(allRolesSet),
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
      // R4: engine now populates this; was [] under R3.
      swapSuggestions: preview.swapSuggestions ?? [],
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

    // Post-0063: assignments + candidates key on personId. The engine
    // populates RefereeAssignment.personId directly; we just look up the
    // candidate (for membership validation) and write person_id on the row.
    const candidateByPersonId = new Map<string, AssignmentBoardCandidate>();
    for (const candidate of context.candidates) {
      candidateByPersonId.set(candidate.personId, candidate);
    }
    // R4: assignments may target a real pool or a synthetic bracket "pool"
    // (poolId prefixed with `match-`). scope_type + pool_id/match_id mirror
    // that distinction.
    const rows = assignments
      .map((assignment) => {
        const candidate = candidateByPersonId.get(assignment.personId);
        const pool = context.pools.find((p) => p.id === assignment.poolId);
        if (!candidate || !pool) return null;
        const isMatchScoped = (pool.kind ?? 'pool') !== 'pool';
        return {
          event_id: eventId,
          person_id: candidate.personId,
          scope_type: isMatchScoped ? 'match' : 'pool',
          pool_id: isMatchScoped ? null : assignment.poolId,
          match_id: isMatchScoped ? (pool.matchId ?? null) : null,
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

    // Defence in depth: drop any row where the person is a member of
    // the pool they'd be reffing. The engine has its own filter, and
    // applyManual throws upstream, but we guard the chokepoint so a
    // future bypass (engine bug, manual SQL, etc.) can't reintroduce
    // a fighter-as-own-referee row. A logger.warn surfaces hits.
    const fightersByPool = buildFightersByPool(context.pools);
    const filteredRows = rows.filter((row) => {
      if (!row.pool_id) return true;
      const members = fightersByPool.get(row.pool_id);
      if (members?.has(row.person_id)) {
        this.logger.warn(
          `Dropped fighter-conflict referee assignment: person=${row.person_id} pool=${row.pool_id} role=${row.role}`,
        );
        return false;
      }
      return true;
    });
    if (filteredRows.length === 0) return;

    if (!replaceAutoAssigned && filteredRows.length === 1) {
      const row = filteredRows[0]!;
      // Single manual write: clear any existing assignment for the same
      // (scope, target, role) tuple before inserting the new one.
      if (row.scope_type === 'pool' && row.pool_id) {
        await this.supabase.service
          .from('referee_assignments')
          .delete()
          .eq('event_id', eventId)
          .eq('scope_type', 'pool')
          .eq('pool_id', row.pool_id)
          .eq('role', row.role);
      } else if (row.scope_type === 'match' && row.match_id) {
        await this.supabase.service
          .from('referee_assignments')
          .delete()
          .eq('event_id', eventId)
          .eq('scope_type', 'match')
          .eq('match_id', row.match_id)
          .eq('role', row.role);
      }
    }

    const { error } = await this.supabase.service.from('referee_assignments').insert(filteredRows);
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
