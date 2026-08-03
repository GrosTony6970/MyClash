/**
 * StaffingService — per-tournament referee slot configuration.
 *
 * The legacy assignment + pool screens hard-coded 3 referee roles
 * (`arbitre_declarant` / `arbitre_assesseur` / `arbitre_table`). This
 * service introduces a config-driven slot list per (tournament,
 * phase_type), with an event-level default fallback and a hard-coded
 * floor that preserves legacy behaviour when neither row exists.
 *
 * Resolver order in `getResolvedConfig`:
 *   1. tournament_slot_config rows for (tournament_id, phase_type)
 *   2. event_slot_config_default rows for (event_id, phase_type)
 *   3. Hard-coded floor — 3 slots, one of arbitre_declarant /
 *      arbitre_assesseur / arbitre_table each.
 *
 * Writes (`putTournamentConfig`, `putEventDefault`) compute an
 * "affected-assignments" list — existing `referee_assignments` rows
 * whose `role` or slot-position would become invalid under the new
 * config — and either throw ConflictException listing them (default)
 * or cascade-delete them (when `confirmDestructive: true`).
 */
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { OrganizationsService } from '../organizations/organizations.service';
import type { StaffingConfigPayloadDto, StaffingSlotDto } from './dto/staffing.dto';

export type PhaseType = 'pool' | 'swiss' | 'bracket' | 'finals';

/**
 * The four slot buckets, in the order the Staffing tab renders them. Iterated
 * by every write path so a new phase type is added in exactly one place.
 */
export const PHASE_TYPES: readonly PhaseType[] = ['pool', 'swiss', 'bracket', 'finals'] as const;

export interface ResolvedSlot {
  index: number;
  displayName: string | null;
  allowedSkillIds: string[];
}

/** The slot rows for every phase type, without the resolution metadata. */
export type PhaseSlots = Record<PhaseType, ResolvedSlot[]>;

export interface ResolvedConfig extends PhaseSlots {
  inheritsEventDefault: boolean; // true when the tournament has no rows of its own
  isHardCodedFloor: boolean; // true when neither tournament nor event rows exist
}

export interface AffectedAssignment {
  id: string;
  poolId: string | null;
  matchId: string | null;
  /**
   * Human label for the pool the assignment is scoped to. Populated
   * for pool-scoped assignments so the conflict dialog can show
   * "Déclarant · Pool A" instead of the raw assignment UUID.
   */
  poolName?: string | null;
  /**
   * Human label for the match the assignment is scoped to (e.g.
   * the canonical `match_number_label` like `LSW-QF-M1`).
   */
  matchLabel?: string | null;
  role: string | null;
  reason: 'slot_out_of_range' | 'role_not_allowed';
}

/**
 * Hard-coded floor returned when neither tournament_slot_config nor
 * event_slot_config_default rows exist for the requested phase_type.
 * Mirrors the legacy 3-role assignment board (arbitre_declarant /
 * arbitre_assesseur / arbitre_table) so an event that never touches
 * the Staffing tab keeps working unchanged.
 */
export const HARD_CODED_DEFAULT_SLOTS: ResolvedSlot[] = [
  { index: 1, displayName: null, allowedSkillIds: ['arbitre_declarant'] },
  { index: 2, displayName: null, allowedSkillIds: ['arbitre_assesseur'] },
  { index: 3, displayName: null, allowedSkillIds: ['arbitre_table'] },
];

/** Empty rows for a (tournament|event) — used to detect "no config" state. */
function emptyConfig(): PhaseSlots {
  return { pool: [], swiss: [], bracket: [], finals: [] };
}

/**
 * A Swiss round is a group stage, so its crew looks like a pool's — and every
 * config written before the Swiss format existed has no `swiss` rows at all.
 * Seed the empty bucket from `pool` at read time rather than backfilling rows,
 * so an organiser who later saves an explicit Swiss config simply overrides it
 * and a change to `pool` keeps flowing through until they do.
 *
 * Applied at every resolve site. Never at a write site: persisting the seed
 * would freeze it, which is the opposite of what "inherit" means here.
 */
function seedSwissFromPool(rows: PhaseSlots): PhaseSlots {
  return rows.swiss.length > 0 ? rows : { ...rows, swiss: rows.pool.map((s) => ({ ...s })) };
}

/** Every bucket at the legacy 3-role floor. */
function hardCodedFloor(): PhaseSlots {
  return {
    pool: [...HARD_CODED_DEFAULT_SLOTS],
    swiss: [...HARD_CODED_DEFAULT_SLOTS],
    bracket: [...HARD_CODED_DEFAULT_SLOTS],
    finals: [...HARD_CODED_DEFAULT_SLOTS],
  };
}

@Injectable()
export class StaffingService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly organizations: OrganizationsService,
  ) {}

  // ── Reads ────────────────────────────────────────────────────────────────────

  /**
   * Resolved config for a tournament. Caller's role must be at least
   * `scorekeeper` for the owning org.
   */
  async getResolvedConfig(tournamentId: string, userId: string): Promise<ResolvedConfig> {
    const { eventId, organizationId } = await this.getTournamentContext(tournamentId);
    await this.organizations.assertOrgRole(organizationId, userId, 'scorekeeper');

    const tournamentRows = await this.loadTournamentRows(tournamentId);
    if (hasAnyRows(tournamentRows)) {
      return {
        ...seedSwissFromPool(tournamentRows),
        inheritsEventDefault: false,
        isHardCodedFloor: false,
      };
    }

    const eventRows = await this.loadEventRows(eventId);
    if (hasAnyRows(eventRows)) {
      return {
        ...seedSwissFromPool(eventRows),
        inheritsEventDefault: true,
        isHardCodedFloor: false,
      };
    }

    return {
      ...hardCodedFloor(),
      inheritsEventDefault: true,
      isHardCodedFloor: true,
    };
  }

  /**
   * Resolver-only variant for internal callers that already enforce
   * authorization upstream (e.g. AssignmentBoardService, where the
   * board controller does the scorekeeper gate). Bypasses the org-role
   * check so we don't have to thread a user id through every internal
   * path. Reads only.
   */
  async getResolvedConfigForAssignmentBoard(tournamentId: string): Promise<ResolvedConfig> {
    const { eventId } = await this.getTournamentContext(tournamentId);

    const tournamentRows = await this.loadTournamentRows(tournamentId);
    if (hasAnyRows(tournamentRows)) {
      return {
        ...seedSwissFromPool(tournamentRows),
        inheritsEventDefault: false,
        isHardCodedFloor: false,
      };
    }

    const eventRows = await this.loadEventRows(eventId);
    if (hasAnyRows(eventRows)) {
      return {
        ...seedSwissFromPool(eventRows),
        inheritsEventDefault: true,
        isHardCodedFloor: false,
      };
    }

    return {
      ...hardCodedFloor(),
      inheritsEventDefault: true,
      isHardCodedFloor: true,
    };
  }

  /** Resolved event-default config. Caller's role must be at least `scorekeeper`. */
  async getEventDefault(eventId: string, userId: string): Promise<ResolvedConfig> {
    const organizationId = await this.getEventOrganizationId(eventId);
    await this.organizations.assertOrgRole(organizationId, userId, 'scorekeeper');

    const eventRows = await this.loadEventRows(eventId);
    if (hasAnyRows(eventRows)) {
      return {
        ...seedSwissFromPool(eventRows),
        inheritsEventDefault: false,
        isHardCodedFloor: false,
      };
    }

    return {
      ...hardCodedFloor(),
      inheritsEventDefault: false,
      isHardCodedFloor: true,
    };
  }

  // ── Writes ───────────────────────────────────────────────────────────────────

  /**
   * Whole-config replace for a tournament. Org-admin gated.
   * - Computes affected `referee_assignments` rows that would become
   *   invalid under the new config.
   * - If any exist and `confirmDestructive !== true`, throws
   *   ConflictException with the list. Caller is expected to confirm
   *   and re-PUT with `confirmDestructive: true`.
   * - Otherwise: deletes affected assignments, replaces the slot rows,
   *   and refreshes allowed-skills join rows — all in sequence.
   */
  async putTournamentConfig(
    tournamentId: string,
    payload: StaffingConfigPayloadDto,
    userId: string,
  ): Promise<{ affectedAssignments: AffectedAssignment[] }> {
    validatePayload(payload);
    const { eventId, organizationId } = await this.getTournamentContext(tournamentId);
    await this.organizations.assertOrgRole(organizationId, userId, 'admin');

    const affected = await this.computeAffectedAssignmentsForTournament(tournamentId, payload);
    if (affected.length > 0 && payload.confirmDestructive !== true) {
      throw new ConflictException({
        message:
          'Save would invalidate existing assignments. Re-send with confirmDestructive: true to proceed.',
        affectedAssignments: affected,
      });
    }

    await this.replaceTournamentRows(tournamentId, payload);
    if (affected.length > 0) {
      await this.deleteAssignments(affected.map((a) => a.id));
    }
    // touch event so consumers can invalidate caches
    void eventId;
    return { affectedAssignments: affected };
  }

  /** Whole-config replace for the event default. Org-admin gated. */
  async putEventDefault(
    eventId: string,
    payload: StaffingConfigPayloadDto,
    userId: string,
  ): Promise<{ affectedAssignments: AffectedAssignment[] }> {
    validatePayload(payload);
    const organizationId = await this.getEventOrganizationId(eventId);
    await this.organizations.assertOrgRole(organizationId, userId, 'admin');

    const affected = await this.computeAffectedAssignmentsForEventDefault(eventId, payload);
    if (affected.length > 0 && payload.confirmDestructive !== true) {
      throw new ConflictException({
        message:
          'Save would invalidate existing assignments. Re-send with confirmDestructive: true to proceed.',
        affectedAssignments: affected,
      });
    }

    await this.replaceEventRows(eventId, payload);
    if (affected.length > 0) {
      await this.deleteAssignments(affected.map((a) => a.id));
    }
    return { affectedAssignments: affected };
  }

  /**
   * Drop the tournament's slot_config rows so subsequent reads fall back
   * to the event default (or the hard-coded floor).
   */
  async resetTournamentConfig(tournamentId: string, userId: string): Promise<void> {
    const { organizationId } = await this.getTournamentContext(tournamentId);
    await this.organizations.assertOrgRole(organizationId, userId, 'admin');

    const { error } = await this.supabase.service
      .from('tournament_slot_config')
      .delete()
      .eq('tournament_id', tournamentId);
    if (error) throw new BadRequestException(error.message);
  }

  /**
   * Enumerate slot_config rows (tournament + event) that reference a
   * given skill. Used by the skill-delete check to extend the existing
   * 409 reason list.
   */
  async countSkillReferences(skillId: string): Promise<number> {
    const [{ count: tournamentCount, error: e1 }, { count: eventCount, error: e2 }] =
      await Promise.all([
        this.supabase.service
          .from('tournament_slot_allowed_skills')
          .select('skill_id', { count: 'exact', head: true })
          .eq('skill_id', skillId),
        this.supabase.service
          .from('event_slot_config_default_skills')
          .select('skill_id', { count: 'exact', head: true })
          .eq('skill_id', skillId),
      ]);
    if (e1) throw new BadRequestException(e1.message);
    if (e2) throw new BadRequestException(e2.message);
    return (tournamentCount ?? 0) + (eventCount ?? 0);
  }

  // ── Private: row loading ─────────────────────────────────────────────────────

  private async loadTournamentRows(tournamentId: string) {
    const { data: slotRows, error: slotErr } = await this.supabase.service
      .from('tournament_slot_config')
      .select('id, phase_type, slot_index, display_name')
      .eq('tournament_id', tournamentId)
      .order('slot_index', { ascending: true });
    if (slotErr) throw new BadRequestException(slotErr.message);

    const slots = (slotRows ?? []) as Array<{
      id: string;
      phase_type: PhaseType;
      slot_index: number;
      display_name: string | null;
    }>;
    if (slots.length === 0) return emptyConfig();

    const slotIds = slots.map((s) => s.id);
    const { data: skillRows, error: skillErr } = await this.supabase.service
      .from('tournament_slot_allowed_skills')
      .select('slot_config_id, skill_id')
      .in('slot_config_id', slotIds);
    if (skillErr) throw new BadRequestException(skillErr.message);

    const skillsBySlot = new Map<string, string[]>();
    for (const row of (skillRows ?? []) as Array<{ slot_config_id: string; skill_id: string }>) {
      const arr = skillsBySlot.get(row.slot_config_id) ?? [];
      arr.push(row.skill_id);
      skillsBySlot.set(row.slot_config_id, arr);
    }

    return groupByPhaseType(slots, skillsBySlot);
  }

  private async loadEventRows(eventId: string) {
    const { data: slotRows, error: slotErr } = await this.supabase.service
      .from('event_slot_config_default')
      .select('id, phase_type, slot_index, display_name')
      .eq('event_id', eventId)
      .order('slot_index', { ascending: true });
    if (slotErr) throw new BadRequestException(slotErr.message);

    const slots = (slotRows ?? []) as Array<{
      id: string;
      phase_type: PhaseType;
      slot_index: number;
      display_name: string | null;
    }>;
    if (slots.length === 0) return emptyConfig();

    const slotIds = slots.map((s) => s.id);
    const { data: skillRows, error: skillErr } = await this.supabase.service
      .from('event_slot_config_default_skills')
      .select('slot_config_id, skill_id')
      .in('slot_config_id', slotIds);
    if (skillErr) throw new BadRequestException(skillErr.message);

    const skillsBySlot = new Map<string, string[]>();
    for (const row of (skillRows ?? []) as Array<{ slot_config_id: string; skill_id: string }>) {
      const arr = skillsBySlot.get(row.slot_config_id) ?? [];
      arr.push(row.skill_id);
      skillsBySlot.set(row.slot_config_id, arr);
    }

    return groupByPhaseType(slots, skillsBySlot);
  }

  // ── Private: row writes ──────────────────────────────────────────────────────

  /**
   * Replace strategy: delete-then-insert. We don't attempt diff-apply
   * because slot_index is also the sort key and inserts are cheap.
   * Wrapped in a best-effort sequence — Supabase doesn't expose a
   * transactional batch API to the service-role client we use here.
   */
  private async replaceTournamentRows(tournamentId: string, payload: StaffingConfigPayloadDto) {
    const { error: delErr } = await this.supabase.service
      .from('tournament_slot_config')
      .delete()
      .eq('tournament_id', tournamentId);
    if (delErr) throw new BadRequestException(delErr.message);

    const allInserts: Array<{
      phase_type: PhaseType;
      slot_index: number;
      display_name: string | null;
      tournament_id: string;
      slot_dto: StaffingSlotDto;
    }> = [];
    for (const phaseType of PHASE_TYPES) {
      // `swiss` is optional on the payload: a client that predates the format
      // sends three buckets, and writing nothing lets the read-side pool seed
      // keep answering for it.
      for (const slot of payload[phaseType] ?? []) {
        allInserts.push({
          phase_type: phaseType,
          slot_index: slot.index,
          display_name: slot.displayName ?? null,
          tournament_id: tournamentId,
          slot_dto: slot,
        });
      }
    }
    if (allInserts.length === 0) return;

    const { data: inserted, error: insErr } = await this.supabase.service
      .from('tournament_slot_config')
      .insert(
        allInserts.map((row) => ({
          tournament_id: row.tournament_id,
          phase_type: row.phase_type,
          slot_index: row.slot_index,
          display_name: row.display_name,
        })),
      )
      .select('id, phase_type, slot_index');
    if (insErr) throw new BadRequestException(insErr.message);

    const idByKey = new Map<string, string>();
    for (const r of (inserted ?? []) as Array<{
      id: string;
      phase_type: PhaseType;
      slot_index: number;
    }>) {
      idByKey.set(`${r.phase_type}:${r.slot_index}`, r.id);
    }

    const skillRows: Array<{ slot_config_id: string; skill_id: string }> = [];
    for (const row of allInserts) {
      const id = idByKey.get(`${row.phase_type}:${row.slot_index}`);
      if (!id) continue;
      for (const sid of row.slot_dto.allowedSkillIds) {
        skillRows.push({ slot_config_id: id, skill_id: sid });
      }
    }
    if (skillRows.length > 0) {
      const { error: skErr } = await this.supabase.service
        .from('tournament_slot_allowed_skills')
        .insert(skillRows);
      if (skErr) throw new BadRequestException(skErr.message);
    }
  }

  private async replaceEventRows(eventId: string, payload: StaffingConfigPayloadDto) {
    const { error: delErr } = await this.supabase.service
      .from('event_slot_config_default')
      .delete()
      .eq('event_id', eventId);
    if (delErr) throw new BadRequestException(delErr.message);

    const allInserts: Array<{
      phase_type: PhaseType;
      slot_index: number;
      display_name: string | null;
      event_id: string;
      slot_dto: StaffingSlotDto;
    }> = [];
    for (const phaseType of PHASE_TYPES) {
      for (const slot of payload[phaseType] ?? []) {
        allInserts.push({
          phase_type: phaseType,
          slot_index: slot.index,
          display_name: slot.displayName ?? null,
          event_id: eventId,
          slot_dto: slot,
        });
      }
    }
    if (allInserts.length === 0) return;

    const { data: inserted, error: insErr } = await this.supabase.service
      .from('event_slot_config_default')
      .insert(
        allInserts.map((row) => ({
          event_id: row.event_id,
          phase_type: row.phase_type,
          slot_index: row.slot_index,
          display_name: row.display_name,
        })),
      )
      .select('id, phase_type, slot_index');
    if (insErr) throw new BadRequestException(insErr.message);

    const idByKey = new Map<string, string>();
    for (const r of (inserted ?? []) as Array<{
      id: string;
      phase_type: PhaseType;
      slot_index: number;
    }>) {
      idByKey.set(`${r.phase_type}:${r.slot_index}`, r.id);
    }

    const skillRows: Array<{ slot_config_id: string; skill_id: string }> = [];
    for (const row of allInserts) {
      const id = idByKey.get(`${row.phase_type}:${row.slot_index}`);
      if (!id) continue;
      for (const sid of row.slot_dto.allowedSkillIds) {
        skillRows.push({ slot_config_id: id, skill_id: sid });
      }
    }
    if (skillRows.length > 0) {
      const { error: skErr } = await this.supabase.service
        .from('event_slot_config_default_skills')
        .insert(skillRows);
      if (skErr) throw new BadRequestException(skErr.message);
    }
  }

  // ── Private: affected-assignment detection ──────────────────────────────────

  /**
   * Compute the existing `referee_assignments` rows for this tournament
   * (across all pools and matches in the tournament's phases) whose
   * slot or role would become invalid under the proposed payload.
   *
   * Assignments are matched against the appropriate phase_type config
   * based on the assignment's pool/match phase_type. For matches we
   * fall back to the bracket config; finals classification needs the
   * bracket helper to identify medal matches, but for the destructive
   * check we conservatively treat all bracket matches under the
   * bracket config — narrowing to the (smaller) finals config is a
   * future refinement.
   */
  private async computeAffectedAssignmentsForTournament(
    tournamentId: string,
    payload: StaffingConfigPayloadDto,
  ): Promise<AffectedAssignment[]> {
    // 1. Phases for this tournament → pool/match scope mapping.
    const { data: phases, error: phErr } = await this.supabase.service
      .from('phases')
      .select('id, type')
      .eq('tournament_id', tournamentId);
    if (phErr) throw new BadRequestException(phErr.message);
    const phaseTypeById = new Map<string, string>();
    for (const p of (phases ?? []) as Array<{ id: string; type: string }>) {
      phaseTypeById.set(p.id, p.type);
    }
    const phaseIds = Array.from(phaseTypeById.keys());
    if (phaseIds.length === 0) return [];

    // 2. Pools + matches under these phases.
    const [{ data: pools }, { data: matches }] = await Promise.all([
      this.supabase.service.from('pools').select('id, phase_id, name').in('phase_id', phaseIds),
      this.supabase.service
        .from('matches')
        .select('id, phase_id, match_number_label')
        .in('phase_id', phaseIds),
    ]);
    const poolPhase = new Map<string, string>();
    const poolNameById = new Map<string, string>();
    for (const r of (pools ?? []) as Array<{
      id: string;
      phase_id: string;
      name: string | null;
    }>) {
      poolPhase.set(r.id, r.phase_id);
      if (r.name) poolNameById.set(r.id, r.name);
    }
    const matchPhase = new Map<string, string>();
    const matchLabelById = new Map<string, string>();
    for (const r of (matches ?? []) as Array<{
      id: string;
      phase_id: string;
      match_number_label: string | null;
    }>) {
      matchPhase.set(r.id, r.phase_id);
      if (r.match_number_label) matchLabelById.set(r.id, r.match_number_label);
    }

    // 3. Existing referee_assignments referencing those pools/matches.
    const poolIds = Array.from(poolPhase.keys());
    const matchIds = Array.from(matchPhase.keys());
    if (poolIds.length === 0 && matchIds.length === 0) return [];

    const orParts: string[] = [];
    if (poolIds.length > 0) orParts.push(`pool_id.in.(${poolIds.join(',')})`);
    if (matchIds.length > 0) orParts.push(`match_id.in.(${matchIds.join(',')})`);
    const { data: assignments, error: aErr } = await this.supabase.service
      .from('referee_assignments')
      .select('id, pool_id, match_id, role')
      .or(orParts.join(','));
    if (aErr) throw new BadRequestException(aErr.message);

    const classified = classifyAssignmentsAgainstPayload(
      (assignments ?? []) as Array<{
        id: string;
        pool_id: string | null;
        match_id: string | null;
        role: string | null;
      }>,
      payload,
      (a) => {
        const phaseId = a.pool_id
          ? poolPhase.get(a.pool_id)
          : a.match_id
            ? matchPhase.get(a.match_id)
            : undefined;
        if (!phaseId) return null;
        const type = phaseTypeById.get(phaseId);
        if (type === 'pool') return 'pool';
        // Swiss has its own bucket now — collapsing it onto 'bracket' here
        // validated Swiss assignments against the wrong slot config.
        if (type === 'swiss') return 'swiss';
        if (type === 'single_elim' || type === 'double_elim') return 'bracket';
        return null;
      },
    );

    // Enrich with human labels so the conflict dialog can show
    // "Déclarant · Pool A" / "Assesseur · LSW-QF-M1" rather than the
    // bare assignment UUID. Helper stays decoupled from the
    // resolution layer.
    return classified.map((c) => ({
      ...c,
      poolName: c.poolId ? (poolNameById.get(c.poolId) ?? null) : null,
      matchLabel: c.matchId ? (matchLabelById.get(c.matchId) ?? null) : null,
    }));
  }

  /**
   * For event-default writes, scan every tournament under the event
   * that doesn't have its own tournament_slot_config rows (since those
   * tournaments are the ones inheriting from the event default).
   */
  private async computeAffectedAssignmentsForEventDefault(
    eventId: string,
    payload: StaffingConfigPayloadDto,
  ): Promise<AffectedAssignment[]> {
    const { data: allTournaments, error: tErr } = await this.supabase.service
      .from('tournaments')
      .select('id')
      .eq('event_id', eventId);
    if (tErr) throw new BadRequestException(tErr.message);
    const allIds = ((allTournaments ?? []) as Array<{ id: string }>).map((t) => t.id);
    if (allIds.length === 0) return [];

    const { data: overrideRows, error: oErr } = await this.supabase.service
      .from('tournament_slot_config')
      .select('tournament_id')
      .in('tournament_id', allIds);
    if (oErr) throw new BadRequestException(oErr.message);
    const overridingSet = new Set(
      ((overrideRows ?? []) as Array<{ tournament_id: string }>).map((r) => r.tournament_id),
    );
    const inheritingIds = allIds.filter((id) => !overridingSet.has(id));
    if (inheritingIds.length === 0) return [];

    const out: AffectedAssignment[] = [];
    for (const id of inheritingIds) {
      const partial = await this.computeAffectedAssignmentsForTournament(id, payload);
      out.push(...partial);
    }
    return out;
  }

  private async deleteAssignments(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    const { error } = await this.supabase.service
      .from('referee_assignments')
      .delete()
      .in('id', ids);
    if (error) throw new BadRequestException(error.message);
  }

  // ── Private: lookups ─────────────────────────────────────────────────────────

  private async getTournamentContext(
    tournamentId: string,
  ): Promise<{ eventId: string; organizationId: string }> {
    const { data: tournament, error: tErr } = await this.supabase.service
      .from('tournaments')
      .select('id, event_id')
      .eq('id', tournamentId)
      .maybeSingle();
    if (tErr) throw new BadRequestException(tErr.message);
    if (!tournament) throw new NotFoundException(`Tournament ${tournamentId} not found`);

    const eventId = (tournament as { event_id: string }).event_id;
    const organizationId = await this.getEventOrganizationId(eventId);
    return { eventId, organizationId };
  }

  private async getEventOrganizationId(eventId: string): Promise<string> {
    const { data: event, error: eErr } = await this.supabase.service
      .from('events')
      .select('id, organization_id')
      .eq('id', eventId)
      .maybeSingle();
    if (eErr) throw new BadRequestException(eErr.message);
    if (!event) throw new NotFoundException(`Event ${eventId} not found`);
    return (event as { organization_id: string }).organization_id;
  }
}

// ── Module-private helpers (exported only for tests) ───────────────────────────

export function classifyAssignmentsAgainstPayload(
  assignments: Array<{
    id: string;
    pool_id: string | null;
    match_id: string | null;
    role: string | null;
  }>,
  payload: StaffingConfigPayloadDto,
  classify: (a: { pool_id: string | null; match_id: string | null }) => PhaseType | null,
): AffectedAssignment[] {
  const out: AffectedAssignment[] = [];
  for (const a of assignments) {
    const phaseType = classify(a);
    if (!phaseType) continue;
    // `swiss` is optional on the payload; when it is absent the resolver seeds
    // it from `pool`, so validate against the same slots the board will use.
    const slots =
      phaseType === 'swiss' ? (payload.swiss ?? payload.pool) : (payload[phaseType] ?? []);
    const role = a.role;
    if (!role) continue;
    const slotForRole = slots.find((s) => s.allowedSkillIds.includes(role));
    if (!slotForRole) {
      out.push({
        id: a.id,
        poolId: a.pool_id,
        matchId: a.match_id,
        role,
        reason: 'role_not_allowed',
      });
    }
  }
  return out;
}

function groupByPhaseType(
  slots: Array<{
    id: string;
    phase_type: PhaseType;
    slot_index: number;
    display_name: string | null;
  }>,
  skillsBySlot: Map<string, string[]>,
): PhaseSlots {
  const out = emptyConfig();
  const sorted = [...slots].sort((a, b) => a.slot_index - b.slot_index);
  for (const s of sorted) {
    // Indexed straight off a DB value: a phase_type the CHECK permits but this
    // build does not know would `push` onto undefined and take down every
    // staffing read. Skip it instead.
    const bucket = out[s.phase_type];
    if (!bucket) continue;
    bucket.push({
      index: s.slot_index,
      displayName: s.display_name,
      allowedSkillIds: skillsBySlot.get(s.id) ?? [],
    });
  }
  return out;
}

function hasAnyRows(rows: PhaseSlots) {
  return PHASE_TYPES.some((phaseType) => rows[phaseType].length > 0);
}

function validatePayload(payload: StaffingConfigPayloadDto): void {
  for (const phaseType of PHASE_TYPES) {
    const slots = payload[phaseType];
    // `swiss` is optional — omitting it means "inherit the pool config", which
    // is a valid save. Present-but-empty is not.
    if (slots === undefined && phaseType === 'swiss') continue;
    if (!Array.isArray(slots) || slots.length === 0 || slots.length > 6) {
      throw new BadRequestException(`${phaseType} must have 1..6 slots`);
    }
    for (const slot of slots) {
      if (!Array.isArray(slot.allowedSkillIds) || slot.allowedSkillIds.length === 0) {
        throw new BadRequestException(
          `${phaseType} slot ${slot.index} must allow at least one skill`,
        );
      }
    }
  }
}
