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
import { priorAssignmentsFromRows } from './prior-assignments';
import { runEndIso } from '../schedule/run-end';
import {
  detectConcurrencyShortage,
  detectRefereeConflicts,
  findTimeConflict,
  formatRoundCode,
  type CapacityWarning,
  type RefereeCommitmentPool,
  type RefereeConflict,
} from '@myclash/types';
import { SupabaseService } from '../supabase/supabase.service';
import { SettingsService } from './settings.service';
import { StaffingService, type ResolvedConfig, type ResolvedSlot } from './staffing.service';
import {
  groupSwissMatchesIntoUnits,
  registrationIdsByRound,
  type SwissBoardUnit,
  type SwissUnitMatch,
  type SwissUnitRound,
} from './swiss-board-units';
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
   * single-match pools; 'swiss' for one (round × piste) unit. The frontend
   * groups by this field to split assignment tables into
   * Pool / Swiss / Bracket / Finals sub-sections.
   */
  kind?: 'pool' | 'swiss' | 'bracket' | 'finals';
  /**
   * The match ids this synthetic unit wraps, for every non-'pool' kind. Used
   * by manual assignments to record `scope_type='match'` instead of
   * `scope_type='pool'` — one row per id.
   *
   * A bracket/finals unit carries exactly one; a Swiss unit carries every bout
   * of its round on its piste. It was a single `matchId` until Swiss, so any
   * `=== pool.matchId` comparison is now a membership test.
   */
  matchIds?: string[];
  /**
   * Bracket-only metadata so the frontend can render readable round
   * labels ('Quarter-final #2') instead of the raw 'R{N}P{M}' string.
   * All three undefined for pool-kind rows. Computed once in
   * loadBracketAsPools from already-fetched bracket_slot info.
   */
  bracketRound?: number;
  bracketPosition?: number;
  bracketMaxRound?: number;
  /** Swiss-only: the round this unit belongs to. Undefined for other kinds. */
  swissRound?: number;
  /** Swiss-only: `swiss_rounds.id`, so the frontend can target the round's clear path. */
  swissRoundId?: string;
  members: Array<{
    registrationId: string;
    /**
     * Resolved to `persons.global_person_id` (the same id-space the
     * referee candidate side uses, sourced from `event_referees`).
     * Projecting the event-scoped `persons.id` here would cross two
     * unrelated UUID spaces and silently never match the candidates.
     */
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

/**
 * The schedule board's slice of the referee board: the conflicts, and whether
 * anybody was actually looking for them.
 */
export interface RefereeCrewConflicts {
  conflicts: RefereeConflict[];
  /** The three toggles that gate the rows above, one per `RefereeConflictKind`. */
  rules: {
    /** Gates `officiate_vs_fight`. */
    officiateVsFight: boolean;
    /** Gates `double_booked`. */
    doubleBooked: boolean;
    /** Gates `unavailable`. */
    availability: boolean;
  };
  /** When the server computed these. The banner is the LAGGING half and says so. */
  asOf: string;
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
  /** Referee scheduling conflicts on the *current* assignments: a referee
   *  officiating one pool/bracket while fighting or officiating another at an
   *  overlapping time (any tournament), or assigned outside their availability. */
  conflicts: RefereeConflict[];
  /** Time windows where the parallel pools need more referee slots than there
   *  are free referees. */
  capacityWarnings: CapacityWarning[];
  /** Slots no qualified+available referee can fill (all blocked). */
  deadEndSlots: Array<{ poolId: string; poolName: string; role: string }>;
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

/**
 * The resolved slot list a unit of this kind draws its roles from. One owner:
 * this was a four-way ternary copy-pasted at four call sites, and a fifth kind
 * had to be added to all four or slots silently fell back to `pool`.
 */
export function slotsForKind(
  config: ResolvedConfig | undefined,
  kind: NonNullable<AssignmentBoardPool['kind']>,
): ResolvedSlot[] {
  return config?.[kind] ?? [];
}

/** A unit that stores its assignments as `scope_type='match'` rows. */
function isMatchScopedKind(kind: NonNullable<AssignmentBoardPool['kind']>): boolean {
  return kind !== 'pool';
}

/**
 * Project one Swiss (round × piste) unit into the board's pool shape.
 *
 * `members` is passed in rather than derived here: it is the FULL round's
 * competitors, across every piste, which only the caller can see.
 */
function toSwissBoardPool(
  unit: SwissBoardUnit,
  tournament: TournamentRow | undefined,
  members: AssignmentBoardPool['members'],
): AssignmentBoardPool {
  return {
    id: unit.key,
    // `LSW-S3` — the unit is the whole round on this piste, so it carries no
    // single match number. Same helper the exports and the scoring pad use, so
    // every surface reads one code shape.
    name: formatRoundCode({
      weapon: tournament?.weapon ?? null,
      poolNumber: null,
      bracketRound: null,
      bracketSize: null,
      swissRound: unit.roundNumber,
      matchNumber: null,
    }),
    tournamentId: tournament?.id ?? '',
    tournamentName: tournament?.name ?? '',
    liceId: unit.liceId,
    scheduledStart: unit.scheduledStart,
    scheduledEnd: unit.scheduledEnd,
    kind: 'swiss',
    matchIds: unit.matches.map((m) => m.id),
    swissRound: unit.roundNumber,
    swissRoundId: unit.roundId,
    members,
    matches: unit.matches.map((m) => ({
      id: m.id,
      scheduledAt: m.scheduledAt,
      liceId: m.liceId,
      redRegistrationId: m.redRegistrationId,
      blueRegistrationId: m.blueRegistrationId,
    })),
    roleSlots: [],
  };
}

/** One `referee_assignments` INSERT row. Named so the pool-scoped and
 *  match-scoped branches of the fan-out share one type instead of unioning
 *  into `{}`. */
interface RefereeAssignmentInsert {
  event_id: string;
  person_id: string;
  scope_type: 'pool' | 'match';
  pool_id: string | null;
  match_id: string | null;
  lice_id: null;
  role: string;
  starts_at: string | null;
  ends_at: string | null;
  auto_assigned: boolean;
  status: string;
  conflicts_jsonb: unknown[];
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

/** The person embed shared by the pool-member and Swiss-entrant projections. */
interface PersonEmbedRow {
  id: string;
  global_person_id: string | null;
  given_name: string | null;
  family_name: string | null;
  display_name?: string | null;
  club_id?: string | null;
  clubs?: { name: string | null } | Array<{ name: string | null }> | null;
}

/** A `registrations` row with its person embedded — the Swiss members source. */
interface RegistrationPersonRow {
  id: string;
  person_id: string;
  persons?: PersonEmbedRow | Array<PersonEmbedRow> | null;
}

interface PoolMemberRow {
  registration_id: string;
  registrations?:
    | {
        id: string;
        person_id: string;
        persons?: {
          id: string;
          global_person_id: string | null;
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
          global_person_id: string | null;
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

interface RegistrationRow {
  id: string;
  /** Event-scoped `persons.id` — DO NOT compare against referee
   *  candidate ids without first translating to `global_person_id`. */
  person_id: string;
  tournament_id: string;
  /**
   * `persons.global_person_id` resolved via the nested join in
   * `listRegistrations`. This is the id-space the referee candidate
   * side uses (sourced from `event_referees.person_id`), so we key
   * `fighterRegistrationIdsByPerson` by it. NULL is possible for
   * unclaimed guest persons; those candidates can't be referees
   * anyway, so a NULL key just sits unused.
   */
  global_person_id: string | null;
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
   * Just the referee scheduling conflicts, for the schedule board's banner.
   *
   * `getBoard` answers this already, but it answers about forty other things
   * with it — every candidate and their qualifications, one synthetic pool per
   * bracket and finals bout, capacity windows, swap suggestions. The schedule
   * board wants one field, refreshed after every card move, over a venue's
   * wifi. Same server work, a fraction of the wire.
   *
   * `rules` is the part `getBoard` cannot give. Each conflict kind is gated by
   * its own toggle in referee settings, so a switched-off rule empties the list
   * — and an empty list on a safety banner reads as "all clear" rather than
   * "nobody is checking". Sending the three toggles that gate these rows lets
   * the banner tell those apart. The other toggles gate other outputs and are
   * deliberately not here: this payload should describe only itself.
   */
  async getCrewConflicts(eventId: string): Promise<RefereeCrewConflicts> {
    const context = await this.loadContext(eventId);
    const board = this.buildBoard(context, EMPTY_PREVIEW);
    const rules = context.ruleSettings;
    return {
      conflicts: board.conflicts,
      rules: {
        officiateVsFight: rules.enableOfficiateVsFightRule,
        doubleBooked: rules.enableDoubleBookedRule,
        availability: rules.enableAvailabilityRule,
      },
      asOf: new Date().toISOString(),
    };
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

  /**
   * Remove ONE referee assignment (the pool-card Unassign button and the
   * swap-apply flow). Same lock guard as the bulk clears: a confirmed
   * row means the board is locked and must be unlocked first.
   *
   * A Swiss unit persists one row per bout, so removing the referee from the
   * unit means removing every sibling row for the same (round × piste × role).
   * Deleting only the row the frontend happened to hold would leave the
   * referee assigned to — and paid for — the rest of the round.
   */
  async deleteAssignment(assignmentId: string): Promise<{ deleted: number }> {
    const { data, error } = await this.supabase.service
      .from('referee_assignments')
      .select('id, status, scope_type, match_id, role, event_id')
      .eq('id', assignmentId)
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!data) throw new NotFoundException(`Assignment ${assignmentId} not found`);
    const row = data as {
      id: string;
      status: string;
      scope_type: string;
      match_id: string | null;
      role: string | null;
      event_id: string;
    };
    if (row.status === 'confirmed') {
      throw new ConflictException('Assignments are locked. Unlock the board before removing.');
    }

    const ids = await this.swissSiblingAssignmentIds(row);
    const { error: delErr } = await this.supabase.service
      .from('referee_assignments')
      .delete()
      .in('id', ids);
    if (delErr) throw new BadRequestException(delErr.message);
    return { deleted: ids.length };
  }

  /**
   * Every assignment row that belongs to the same Swiss (round × piste × role)
   * unit as `row`, including `row` itself. Just `[row.id]` for anything that
   * is not a Swiss match-scoped assignment.
   */
  private async swissSiblingAssignmentIds(row: {
    id: string;
    scope_type: string;
    match_id: string | null;
    role: string | null;
    event_id: string;
  }): Promise<string[]> {
    if (row.scope_type !== 'match' || !row.match_id || !row.role) return [row.id];

    const { data: matchRow } = await this.supabase.service
      .from('matches')
      .select('id, swiss_round_id, lice_id')
      .eq('id', row.match_id)
      .maybeSingle();
    const match = matchRow as { swiss_round_id: string | null; lice_id: string | null } | null;
    if (!match?.swiss_round_id) return [row.id];

    // Same round AND same piste: two pistes of one round are two units with
    // their own crews, so the other piste's rows must survive.
    let query = this.supabase.service
      .from('matches')
      .select('id')
      .eq('swiss_round_id', match.swiss_round_id);
    query = match.lice_id ? query.eq('lice_id', match.lice_id) : query.is('lice_id', null);
    const { data: siblingMatches, error: mErr } = await query;
    if (mErr) throw new BadRequestException(mErr.message);
    const matchIds = ((siblingMatches ?? []) as Array<{ id: string }>).map((m) => m.id);
    if (matchIds.length === 0) return [row.id];

    const { data: siblings, error: aErr } = await this.supabase.service
      .from('referee_assignments')
      .select('id')
      .eq('event_id', row.event_id)
      .eq('scope_type', 'match')
      .eq('role', row.role)
      .in('match_id', matchIds);
    if (aErr) throw new BadRequestException(aErr.message);
    const ids = ((siblings ?? []) as Array<{ id: string }>).map((s) => s.id);
    return ids.length > 0 ? ids : [row.id];
  }

  /**
   * Bulk-clear every referee assignment for one Swiss round, across all its
   * pistes. `clearPoolAssignments` cannot serve this: it keys on `pool_id`,
   * and a Swiss phase creates no `pools` rows at all.
   */
  async clearSwissRoundAssignments(roundId: string): Promise<{ deleted: number }> {
    const { data: matches, error: matchesErr } = await this.supabase.service
      .from('matches')
      .select('id')
      .eq('swiss_round_id', roundId);
    if (matchesErr) throw new BadRequestException(matchesErr.message);
    const matchIds = ((matches ?? []) as Array<{ id: string }>).map((m) => m.id);
    if (matchIds.length === 0) return { deleted: 0 };

    const { data: rows, error: rowsErr } = await this.supabase.service
      .from('referee_assignments')
      .select('id, status')
      .eq('scope_type', 'match')
      .in('match_id', matchIds);
    if (rowsErr) throw new BadRequestException(rowsErr.message);

    const all = (rows ?? []) as Array<{ id: string; status: string }>;
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
    const sourceSlots = slotsForKind(config, kind);
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
    // Every reject below is gated by its rule toggle so a disabled rule
    // stops blocking manual assignments too.
    const rules = context.ruleSettings;
    const poolMembers = new Set<string>(pool.members.map((m) => m.personId));
    const fighterRegIds = context.fighterRegistrationIdsByPerson.get(candidate.personId) ?? [];
    if (rules.enableOwnPoolRule) {
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
    }

    // Cross-pool scheduling conflict: busy fighting or officiating another
    // pool/bracket whose window overlaps this one (any tournament, parallel lice).
    const timeConflict = findTimeConflict(
      candidate.personId,
      dto.poolId,
      this.buildCommitmentPools(context),
    );
    if (timeConflict) {
      // A cross-venue double-booking (the referee already officiating an
      // overlapping pool in a DIFFERENT hall) is surfaced as a board warning,
      // not a hard block — parallel-venue events resolve it manually. Same-venue
      // double-booking and officiate-vs-fight still hard-block.
      const shouldBlock =
        timeConflict.kind === 'officiate_vs_fight'
          ? rules.enableOfficiateVsFightRule
          : rules.enableDoubleBookedRule && !timeConflict.crossVenue;
      if (shouldBlock) {
        throw new BadRequestException(
          timeConflict.kind === 'double_booked'
            ? `Referee is already officiating ${timeConflict.otherPoolName} at this time`
            : `Referee is competing in ${timeConflict.otherPoolName} at this time`,
        );
      }
    }
    // Outside the referee's declared tournament/day availability.
    if (
      rules.enableAvailabilityRule &&
      this.isUnavailable(candidate, pool, this.makeDayIndexOf(context.eventStartDate))
    ) {
      throw new BadRequestException('Referee is not available for this tournament or day');
    }

    if (!candidate.qualifications.some((q) => q.role === dto.role)) {
      throw new BadRequestException('Selected referee is not qualified for this role');
    }

    // Slice 7b: same person cannot hold two different roles on the same
    // pool / bracket match / Swiss round-piste. The auto-assigner already
    // enforces this via `alreadyAssignedToPool` (referee-assigner.ts:449-461)
    // — the manual PATCH was the missing entry-point. Match by pool_id for
    // real pools and by match_id membership for the synthetic projections.
    const unitMatchIds = new Set(pool.matchIds ?? []);
    const conflictingExisting = context.assignments.find((a) => {
      if (a.person_id !== candidate.personId || a.role === dto.role) return false;
      if (isMatchScopedKind(kind)) return a.match_id !== null && unitMatchIds.has(a.match_id);
      return a.pool_id === pool.id;
    });
    if (conflictingExisting && rules.enableTwoRolesRule) {
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

    // Per-rule toggles (own pool / officiate-vs-fight / …) gate every
    // enforcement point downstream: engine filters, candidate blocking,
    // manual-assign rejects, and the conflicts/capacity payload.
    const ruleSettings = await this.settings.getSettings(eventId);

    const tournaments = await this.listTournaments(eventId);
    if (tournaments.length === 0) {
      return {
        eventId,
        eventStartDate,
        ruleSettings,
        tournaments,
        phases: [] as PhaseRow[],
        pools: [] as AssignmentBoardPool[],
        candidates: [] as AssignmentBoardCandidate[],
        assignments: [] as RefereeAssignmentRow[],
        fighterRegistrationIdsByPerson: new Map<string, string[]>(),
        slotConfigByTournament: new Map<string, ResolvedConfig>(),
        venueByLiceId: new Map<string, { id: string; name: string }>(),
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
    // Key by `global_person_id` so the map's keys live in the same
    // id-space as the referee candidate (`event_referees.person_id`).
    // A NULL global id (unclaimed guest persons) means the candidate
    // can't be a referee anyway — skip them; no candidate would look
    // up a NULL key.
    const fighterRegistrationIdsByPerson = new Map<string, string[]>();
    for (const registration of registrations) {
      if (!registration.global_person_id) continue;
      const existing = fighterRegistrationIdsByPerson.get(registration.global_person_id) ?? [];
      existing.push(registration.id);
      fighterRegistrationIdsByPerson.set(registration.global_person_id, existing);
    }
    const assignments = await this.listAssignments(eventId);

    // Lice → venue map, so a referee's double-booking warning can name the
    // clashing hall and tell cross-venue (warn) from same-venue. lices/venues
    // have no RLS (service role + org checks own this surface).
    const venueByLiceId = new Map<string, { id: string; name: string }>();
    const { data: liceVenueRows } = await this.supabase.service
      .from('lices')
      .select('id, venues(id, name)')
      .eq('event_id', eventId);
    for (const r of (liceVenueRows ?? []) as unknown as Array<{
      id: string;
      venues: { id: string; name: string } | null;
    }>) {
      if (r.venues) {
        venueByLiceId.set(String(r.id), { id: String(r.venues.id), name: String(r.venues.name) });
      }
    }

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
    // Swiss phases contribute one unit per (round × piste) — several bouts per
    // unit, unlike bracket's one.
    const swissPools = await this.loadSwissRoundsAsPools(tournamentIds, tournamentById);
    const allPools = [...pools, ...swissPools, ...bracketPools];

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
      ruleSettings,
      tournaments,
      phases,
      pools: allPools,
      candidates,
      assignments,
      fighterRegistrationIdsByPerson,
      slotConfigByTournament,
      venueByLiceId,
      locked: assignments.some((a) => a.status === 'confirmed'),
    };
  }

  /**
   * R4: load bracket matches as synthetic "pool of one match" entries.
   * `kind` and `matchIds` on each entry let the rest of the pipeline
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
      const scheduledEnd = m.scheduled_at ? runEndIso([m.scheduled_at]) : null;

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
        matchIds: [m.id],
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
   * Load a Swiss phase as synthetic units, one per **(round × piste)**.
   *
   * Unlike a bracket match, a Swiss unit wraps several bouts: the consecutive
   * matches of round N that run on lice L. That is genuinely pool-shaped —
   * one crew, one piste, back-to-back bouts — so the rest and
   * no-back-to-back constraints downstream stay meaningful.
   *
   * `members` is the FULL round's competitors, across every piste, not just
   * this unit's. A fighter competing in round N must not referee round N
   * whichever piste either of them is on, because both run at the same time.
   */
  private async loadSwissRoundsAsPools(
    tournamentIds: string[],
    tournamentById: Map<string, TournamentRow>,
  ): Promise<AssignmentBoardPool[]> {
    const loaded = await this.loadSwissPhaseData(tournamentIds);
    if (!loaded) return [];
    const { tournamentIdByPhase, rounds, matches } = loaded;

    const regIdsByRound = registrationIdsByRound(matches);
    const memberByRegId = await this.loadSwissMembers(
      [...new Set(matches.flatMap((m) => [m.redRegistrationId, m.blueRegistrationId]))].filter(
        (id): id is string => id !== null,
      ),
    );

    return groupSwissMatchesIntoUnits(rounds, matches).map((unit) => {
      const tournamentId = tournamentIdByPhase.get(unit.phaseId);
      return toSwissBoardPool(
        unit,
        tournamentId ? tournamentById.get(tournamentId) : undefined,
        [...(regIdsByRound.get(unit.roundId) ?? [])]
          .map((regId) => memberByRegId.get(regId))
          .filter((m): m is AssignmentBoardPool['members'][number] => m !== undefined),
      );
    });
  }

  /**
   * The three reads behind {@link loadSwissRoundsAsPools}: swiss phases →
   * their rounds → those rounds' matches. Returns null as soon as a level is
   * empty, so the caller does no work and the query chain short-circuits.
   */
  private async loadSwissPhaseData(tournamentIds: string[]): Promise<{
    tournamentIdByPhase: Map<string, string>;
    rounds: SwissUnitRound[];
    matches: SwissUnitMatch[];
  } | null> {
    if (tournamentIds.length === 0) return null;
    const { data: swissPhases, error: phErr } = await this.supabase.service
      .from('phases')
      .select('id, tournament_id')
      .in('tournament_id', tournamentIds)
      .eq('type', 'swiss');
    if (phErr) throw new BadRequestException(phErr.message);
    const phases = (swissPhases ?? []) as Array<{ id: string; tournament_id: string }>;
    if (phases.length === 0) return null;

    const { data: roundRows, error: rErr } = await this.supabase.service
      .from('swiss_rounds')
      .select('id, phase_id, round_number')
      .in(
        'phase_id',
        phases.map((p) => p.id),
      );
    if (rErr) throw new BadRequestException(rErr.message);
    const rounds = (
      (roundRows ?? []) as Array<{ id: string; phase_id: string; round_number: number }>
    ).map<SwissUnitRound>((r) => ({
      id: r.id,
      phaseId: r.phase_id,
      roundNumber: r.round_number,
    }));
    if (rounds.length === 0) return null;

    const matches = await this.loadSwissMatchRows(rounds.map((r) => r.id));
    if (matches.length === 0) return null;

    return {
      tournamentIdByPhase: new Map(phases.map((p) => [p.id, p.tournament_id])),
      rounds,
      matches,
    };
  }

  /** Every match of the given Swiss rounds, in the units grouper's shape. */
  private async loadSwissMatchRows(roundIds: string[]): Promise<SwissUnitMatch[]> {
    const { data, error } = await this.supabase.service
      .from('matches')
      .select(
        'id, swiss_round_id, scheduled_at, lice_id, red_registration_id, blue_registration_id',
      )
      .in('swiss_round_id', roundIds);
    if (error) throw new BadRequestException(error.message);
    return (
      (data ?? []) as Array<{
        id: string;
        swiss_round_id: string | null;
        scheduled_at: string | null;
        lice_id: string | null;
        red_registration_id: string | null;
        blue_registration_id: string | null;
      }>
    )
      .filter((m): m is typeof m & { swiss_round_id: string } => m.swiss_round_id !== null)
      .map((m) => ({
        id: m.id,
        swissRoundId: m.swiss_round_id,
        liceId: m.lice_id,
        scheduledAt: m.scheduled_at,
        redRegistrationId: m.red_registration_id,
        blueRegistrationId: m.blue_registration_id,
      }));
  }

  /**
   * Registration → board member, for the Swiss overlap guard.
   *
   * `personId` resolves to `persons.global_person_id`, the id-space the
   * referee candidates come from (`event_referees.person_id`). Projecting the
   * event-scoped `persons.id` would compare two unrelated UUID spaces and
   * silently never match — the Denis-Allaume bug.
   */
  private async loadSwissMembers(
    registrationIds: string[],
  ): Promise<Map<string, AssignmentBoardPool['members'][number]>> {
    const out = new Map<string, AssignmentBoardPool['members'][number]>();
    if (registrationIds.length === 0) return out;
    const { data, error } = await this.supabase.service
      .from('registrations')
      .select(
        'id, person_id, persons(id, global_person_id, given_name, family_name, display_name, club_id, clubs(name))',
      )
      .in('id', registrationIds);
    if (error) throw new BadRequestException(error.message);
    for (const row of (data ?? []) as unknown as RegistrationPersonRow[]) {
      const person = this.firstRelation(row.persons);
      const club = this.firstRelation(person?.clubs);
      out.set(row.id, {
        registrationId: row.id,
        personId: person?.global_person_id ?? '',
        personName: this.formatName(person),
        clubLabel: club?.name ?? null,
      });
    }
    return out;
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
        'id, phase_id, name, sort_order, pool_members(registration_id, registrations(id, person_id, persons(id, global_person_id, given_name, family_name, club_id, clubs(name)))), matches(id, scheduled_at, lice_id, red_registration_id, blue_registration_id)',
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
      // End = last match start + inferred per-match interval, matching the
      // schedule grid (not a hardcoded +5 min, which mismatched the grid).
      const scheduledEnd = runEndIso(scheduledTimes);
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
            // The fighter-as-own-referee guards (engine filter,
            // applyManual, and the persistAssignments chokepoint) all
            // compare `member.personId` against the referee
            // candidate's `personId`, which is sourced from
            // `event_referees.person_id` — a `global_persons.id`.
            // Projecting the event-scoped `persons.id` here would
            // mean the comparison crosses two unrelated UUID spaces
            // and silently never matches (the Denis-Allaume bug).
            personId: person?.global_person_id ?? '',
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
      .select('id, person_id, tournament_id, persons(global_person_id)')
      .in('tournament_id', tournamentIds)
      .in('status', ['registered', 'checked_in']);
    if (error) throw new BadRequestException(error.message);
    type Raw = {
      id: string;
      person_id: string;
      tournament_id: string;
      persons?:
        { global_person_id: string | null } | Array<{ global_person_id: string | null }> | null;
    };
    return ((data ?? []) as Raw[]).map((row) => {
      const person = this.firstRelation(row.persons);
      return {
        id: row.id,
        person_id: row.person_id,
        tournament_id: row.tournament_id,
        global_person_id: person?.global_person_id ?? null,
      };
    });
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
        // Pool roster — closes the gap where a fighter is registered
        // for the pool but their match's red/blue registration ID isn't
        // wired up yet (pre-bracket-generation, dropped registrations,
        // etc.). The engine's hard fighter-conflict filter checks this
        // alongside the per-match registration list.
        memberPersonIds: pool.members.map((m) => m.personId),
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

    // Manually-assigned referees (auto_assigned=false) are FIXED constraints:
    // the engine won't re-fill their slot and won't propose anyone who'd
    // conflict with them. Auto chips are wiped & regenerated, so they don't
    // constrain. Both preview (dry-run) and apply flow through here, so they
    // stay consistent.
    const priorAssignments = priorAssignmentsFromRows(context.assignments, context.pools);

    const poolSettings = context.ruleSettings;
    return assignRefereesWithPools(
      poolSlots,
      engineCandidates,
      {
        enforceRefereeNoBackToBack: poolSettings.enforceRefereeNoBackToBack,
        refereeRestMinSlots: poolSettings.refereeRestMinSlots,
        enforceDedicatedRefereeRest: poolSettings.enforceDedicatedRefereeRest,
        workshopConflictWarning: poolSettings.workshopConflictWarning,
        ratingBasedOrdering: poolSettings.ratingBasedOrdering,
        workloadBalance: poolSettings.workloadBalance,
        enableOwnPoolRule: poolSettings.enableOwnPoolRule,
        enableOfficiateVsFightRule: poolSettings.enableOfficiateVsFightRule,
        enableDoubleBookedRule: poolSettings.enableDoubleBookedRule,
        enableTwoRolesRule: poolSettings.enableTwoRolesRule,
        enableAvailabilityRule: poolSettings.enableAvailabilityRule,
      },
      priorAssignments,
    );
  }

  private makeDayIndexOf(eventStartDate: string | null): (iso: string) => number {
    const startMs = eventStartDate ? new Date(eventStartDate).setHours(0, 0, 0, 0) : null;
    return (iso: string) =>
      startMs == null
        ? 0
        : Math.max(0, Math.floor((new Date(iso).getTime() - startMs) / 86_400_000));
  }

  /** Project the loaded context into the shared conflict-detector shape:
   *  every pool/bracket with its window, the people fighting in it (pool
   *  roster ∪ the single match's red/blue fighters), and its persisted
   *  referee assignments. */
  private buildCommitmentPools(
    context: Awaited<ReturnType<AssignmentBoardService['loadContext']>>,
  ): RefereeCommitmentPool[] {
    const personNameById = new Map(context.candidates.map((c) => [c.personId, c.displayName]));
    const personIdByRegId = new Map<string, string>();
    for (const [personId, regIds] of context.fighterRegistrationIdsByPerson) {
      for (const regId of regIds) personIdByRegId.set(regId, personId);
    }
    return context.pools.map((pool) => {
      const kind = pool.kind ?? 'pool';
      const slotConfig = context.slotConfigByTournament.get(pool.tournamentId);
      const slots = slotsForKind(slotConfig, kind);
      const unitMatchIds = new Set(pool.matchIds ?? []);
      const fighterPersonIds = Array.from(
        new Set<string>([
          ...pool.members.map((m) => m.personId),
          ...pool.matches
            .flatMap((m) => [m.redRegistrationId, m.blueRegistrationId])
            .filter((r): r is string => Boolean(r))
            .map((r) => personIdByRegId.get(r))
            .filter((p): p is string => Boolean(p)),
        ]),
      );
      const assignments: RefereeCommitmentPool['assignments'] = [];
      for (const a of context.assignments) {
        if (!a.role || !a.person_id) continue;
        const matchesPool =
          kind === 'pool'
            ? a.pool_id === pool.id
            : a.match_id !== null && unitMatchIds.has(a.match_id);
        if (matchesPool) {
          assignments.push({
            personId: a.person_id,
            personName: personNameById.get(a.person_id) ?? a.person_id,
            role: a.role,
          });
        }
      }
      const venue = pool.liceId ? (context.venueByLiceId.get(pool.liceId) ?? null) : null;
      return {
        id: pool.id,
        name: pool.name,
        tournamentId: pool.tournamentId,
        tournamentName: pool.tournamentName,
        scheduledStart: pool.scheduledStart,
        scheduledEnd: pool.scheduledEnd,
        liceName: null,
        venueId: venue?.id ?? null,
        venueName: venue?.name ?? null,
        roleSlotCount: slots.length,
        fighterPersonIds,
        assignments,
      };
    });
  }

  /** True when the pool's tournament/day is outside the candidate's declared
   *  availability (mirrors the auto-assigner's hard filter). */
  private isUnavailable(
    candidate: AssignmentBoardCandidate,
    pool: AssignmentBoardPool,
    dayIndexOf: (iso: string) => number,
  ): boolean {
    if (
      candidate.availableTournamentIds &&
      !candidate.availableTournamentIds.includes(pool.tournamentId)
    ) {
      return true;
    }
    if (
      candidate.availableDayIndices &&
      pool.scheduledStart &&
      !candidate.availableDayIndices.includes(dayIndexOf(pool.scheduledStart))
    ) {
      return true;
    }
    return false;
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
    // the lookup with a uniform `${unitId}:${role}` string so the per-pool
    // roleSlot matcher doesn't care which scope produced it.
    //
    // The unit id for a match-scoped row is resolved through the loaded units
    // rather than rebuilt as `match-${match_id}`. That shortcut held only
    // while every match-scoped unit wrapped exactly one match; a Swiss unit
    // wraps a whole (round × piste), so the string would never match and
    // every Swiss slot would render empty however many rows were persisted.
    const unitIdByMatchId = new Map<string, string>();
    for (const pool of context.pools) {
      for (const matchId of pool.matchIds ?? []) unitIdByMatchId.set(matchId, pool.id);
    }
    const assignmentByPoolRole = new Map<string, RefereeAssignmentRow>();
    for (const assignment of context.assignments) {
      if (!assignment.role) continue;
      if (assignment.pool_id) {
        assignmentByPoolRole.set(`${assignment.pool_id}:${assignment.role}`, assignment);
      } else if (assignment.match_id) {
        const unitId = unitIdByMatchId.get(assignment.match_id);
        // A Swiss unit's N rows all resolve to the same key. They are written
        // and deleted together, so the first one wins and reads the same.
        if (unitId) assignmentByPoolRole.set(`${unitId}:${assignment.role}`, assignment);
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

    // Shared inputs for the scheduling-conflict + availability checks.
    const dayIndexOf = this.makeDayIndexOf(context.eventStartDate);
    const commitmentPools = this.buildCommitmentPools(context);
    const rules = context.ruleSettings;

    // R2 + R4: roleSlots come from the resolved Staffing config per
    // tournament, selecting `pool`/`bracket`/`finals` based on the
    // pool's R4 `kind`. The legacy 3-role default still kicks in when
    // no Staffing rows exist (HARD_CODED_DEFAULT_SLOTS in staffing.service).
    const pools = context.pools.map((pool) => {
      const poolMembers = new Set(pool.members.map((member) => member.personId));
      const slotConfig = context.slotConfigByTournament.get(pool.tournamentId);
      const kind = pool.kind ?? 'pool';
      const slots = slotsForKind(slotConfig, kind);
      const unitMatchIds = new Set(pool.matchIds ?? []);

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
            if (
              rules.enableOwnPoolRule &&
              candidate.personId &&
              poolMembers.has(candidate.personId)
            ) {
              reasons.push('fighter_referee_overlap');
            }
            // Busy at this time elsewhere (fighting or officiating another
            // pool/bracket whose window overlaps — any tournament). Each
            // collision kind is gated by its own rule toggle.
            if (candidate.personId) {
              const collision = findTimeConflict(candidate.personId, pool.id, commitmentPools);
              if (
                collision &&
                (collision.kind === 'officiate_vs_fight'
                  ? rules.enableOfficiateVsFightRule
                  : rules.enableDoubleBookedRule)
              ) {
                reasons.push('schedule_conflict');
              }
            }
            // Outside the referee's declared tournament/day availability.
            if (rules.enableAvailabilityRule && this.isUnavailable(candidate, pool, dayIndexOf)) {
              reasons.push('unavailable');
            }
            // Already holding a different role on this same pool/bracket/round.
            if (
              rules.enableTwoRolesRule &&
              candidate.personId &&
              context.assignments.some(
                (a) =>
                  a.person_id === candidate.personId &&
                  a.role &&
                  a.role !== primaryRole &&
                  (kind === 'pool'
                    ? a.pool_id === pool.id
                    : a.match_id !== null && unitMatchIds.has(a.match_id)),
              )
            ) {
              reasons.push('duplicate_role_same_pool');
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

    // Scheduling conflicts on the *current* assignments: time overlaps from the
    // pure detector, plus any assigned referee now outside their availability.
    const poolById = new Map(context.pools.map((p) => [p.id, p]));
    const availabilityConflicts: RefereeConflict[] = [];
    for (const cp of commitmentPools) {
      const rawPool = poolById.get(cp.id);
      if (!rawPool) continue;
      for (const a of cp.assignments) {
        const cand = candidateByPersonId.get(a.personId);
        if (cand && this.isUnavailable(cand, rawPool, dayIndexOf)) {
          availabilityConflicts.push({
            personId: a.personId,
            personName: a.personName,
            kind: 'unavailable',
            poolId: cp.id,
            poolName: cp.name,
            role: a.role,
            start: cp.scheduledStart,
            liceName: null,
            otherPoolId: '',
            otherPoolName: cp.tournamentName ?? '',
            otherLiceName: null,
          });
        }
      }
    }
    // Each conflict kind is gated by its rule toggle, so unticking a rule
    // in the health panel removes its findings everywhere at once.
    const conflicts = [
      ...detectRefereeConflicts(commitmentPools).filter((c) =>
        c.kind === 'officiate_vs_fight'
          ? rules.enableOfficiateVsFightRule
          : rules.enableDoubleBookedRule,
      ),
      ...(rules.enableAvailabilityRule ? availabilityConflicts : []),
    ];
    const capacityWarnings = rules.enableCapacityRule
      ? detectConcurrencyShortage(
          commitmentPools,
          context.candidates.map((c) => ({
            personId: c.personId,
            roles: c.qualifications.map((q) => q.role),
            ...(c.availableTournamentIds
              ? { availableTournamentIds: c.availableTournamentIds }
              : {}),
            ...(c.availableDayIndices ? { availableDayIndices: c.availableDayIndices } : {}),
          })),
          dayIndexOf,
        )
      : [];
    const deadEndSlots: AssignmentBoard['deadEndSlots'] = [];
    for (const pool of pools) {
      for (const slot of pool.roleSlots) {
        if (!slot.assignment && slot.candidates.recommended.length === 0) {
          deadEndSlots.push({ poolId: pool.id, poolName: pool.name, role: slot.role });
        }
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
      conflicts,
      capacityWarnings,
      deadEndSlots,
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
    // R4: assignments may target a real pool or a synthetic unit (a bracket
    // match, or a Swiss round × piste). scope_type + pool_id/match_id mirror
    // that distinction.
    //
    // A synthetic unit fans out to ONE ROW PER MATCH. `scope_type='lice'` is
    // not an option even though a Swiss round-piste looks session-shaped:
    // qualifications.service.ts deliberately excludes lice-scoped rows from
    // workload counts ("a full session, not a determinate match list"), so
    // every Swiss duty would vanish from referee stats and compensation.
    const rows = assignments.flatMap<RefereeAssignmentInsert>((assignment) => {
      const candidate = candidateByPersonId.get(assignment.personId);
      const pool = context.pools.find((p) => p.id === assignment.poolId);
      if (!candidate || !pool) return [];
      const base = {
        event_id: eventId,
        person_id: candidate.personId,
        // CHECK referee_assignments_scope_check (migration 0091)
        // requires lice_id IS NULL for both 'pool' and 'match'
        // scopes; lice_id is reserved for the 'lice' scope, which
        // this code path never constructs. Writing pool.liceId here
        // (a denormalised convenience of where the pool is
        // anchored) fails the constraint and 400s the INSERT.
        lice_id: null,
        role: assignment.role,
        starts_at: pool.scheduledStart,
        ends_at: pool.scheduledEnd,
        auto_assigned: replaceAutoAssigned,
        status: 'assigned',
        conflicts_jsonb: [],
      } satisfies Omit<RefereeAssignmentInsert, 'scope_type' | 'pool_id' | 'match_id'>;
      if (!isMatchScopedKind(pool.kind ?? 'pool')) {
        return [{ ...base, scope_type: 'pool', pool_id: assignment.poolId, match_id: null }];
      }
      return (pool.matchIds ?? []).map((matchId) => ({
        ...base,
        scope_type: 'match',
        pool_id: null,
        match_id: matchId,
      }));
    });

    if (rows.length === 0) return;

    // Defence in depth: drop any row where the person is a member of
    // the unit they'd be reffing. The engine has its own filter, and
    // applyManual throws upstream, but we guard the chokepoint so a
    // future bypass (engine bug, manual SQL, etc.) can't reintroduce
    // a fighter-as-own-referee row. A logger.warn surfaces hits.
    //
    // Match-scoped rows are resolved back to their unit rather than skipped:
    // a bracket unit carries `members: []` so its behaviour is unchanged, but
    // a Swiss unit carries the whole round's competitors and this is the last
    // line of defence for them.
    const fightersByPool = buildFightersByPool(context.pools);
    const unitIdByMatchId = new Map<string, string>();
    for (const pool of context.pools) {
      for (const matchId of pool.matchIds ?? []) unitIdByMatchId.set(matchId, pool.id);
    }
    const filteredRows = rows.filter((row) => {
      const unitId = row.pool_id ?? (row.match_id ? unitIdByMatchId.get(row.match_id) : null);
      if (!unitId) return true;
      const members = fightersByPool.get(unitId);
      if (members?.has(row.person_id)) {
        this.logger.warn(
          `Dropped fighter-conflict referee assignment: person=${row.person_id} unit=${unitId} role=${row.role}`,
        );
        return false;
      }
      return true;
    });
    if (filteredRows.length === 0) return;

    // Single manual write: clear any existing assignment for the same
    // (scope, target, role) tuple before inserting the new one. Keyed off the
    // caller's intent (one assignment) rather than the row count, because a
    // Swiss unit turns one assignment into N rows.
    if (!replaceAutoAssigned && assignments.length === 1) {
      const row = filteredRows[0]!;
      if (row.scope_type === 'pool' && row.pool_id) {
        await this.supabase.service
          .from('referee_assignments')
          .delete()
          .eq('event_id', eventId)
          .eq('scope_type', 'pool')
          .eq('pool_id', row.pool_id)
          .eq('role', row.role);
      } else {
        const matchIds = filteredRows
          .map((r) => r.match_id)
          .filter((id): id is string => id !== null);
        if (matchIds.length > 0) {
          await this.supabase.service
            .from('referee_assignments')
            .delete()
            .eq('event_id', eventId)
            .eq('scope_type', 'match')
            .in('match_id', matchIds)
            .eq('role', row.role);
        }
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
