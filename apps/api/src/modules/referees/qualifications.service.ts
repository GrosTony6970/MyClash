/**
 * qualifications.service.ts — T-901 / T-906 / T-903 (Task 3)
 *
 * CRUD for referee_qualifications (per-event role + rating).
 * Skills catalog: system skills + per-event custom skills.
 * Per-event availability flags + assignment counts.
 *
 * AC:
 *   - 0..3 active qualifications per user per event (one per role)
 *   - Rating 1..5 or null
 *   - Soft delete via active=false preserves history
 *   - System skills cannot be edited or deleted
 *   - Custom skills cannot be deleted if active qualifications reference them
 *   - event_referees: idempotent ensure, availability flags, enriched list
 */

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { OrganizationsService } from '../organizations/organizations.service';
import { SupabaseService } from '../supabase/supabase.service';

// ── Referee Skill types ───────────────────────────────────────────────────────

export interface RefereeSkill {
  id: string;
  eventId: string | null;
  name: string;
  color: string;
  isSystem: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateRefereeSkillDto {
  name: string;
  color: string;
}

export interface UpdateRefereeSkillDto {
  name?: string;
  color?: string;
}

export type RefereeRole = 'arbitre_declarant' | 'arbitre_assesseur' | 'arbitre_table';

export const REFEREE_ROLES: RefereeRole[] = [
  'arbitre_declarant',
  'arbitre_assesseur',
  'arbitre_table',
];

export interface RefereeQualification {
  id: string;
  eventId: string;
  personId: string;
  role: RefereeRole;
  rating: number | null;
  active: boolean;
  createdAt: string;
}

// ── Task 3 types ──────────────────────────────────────────────────────────────

export interface UpdateRefereeAvailabilityDto {
  availableAllTournaments?: boolean;
  availableAllEventDuration?: boolean;
}

export interface EventRefereeRow {
  userId: string;
  personId: string | null;
  displayName: string;
  clubLabel: string | null;
  qualifications: Array<{ skillId: string; rating: number | null }>;
  availableAllTournaments: boolean;
  availableAllEventDuration: boolean;
  assignments: Array<{ tournamentId: string; tournamentName: string; matchCount: number }>;
  totalMatchCount: number;
}

@Injectable()
export class QualificationsService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly organizations: OrganizationsService,
  ) {}

  // ── List qualifications for event ────────────────────────────────────────────

  async listForEvent(eventId: string, activeOnly = true): Promise<RefereeQualification[]> {
    let q = this.supabase.service
      .from('referee_qualifications')
      .select('*, persons ( given_name, family_name )')
      .eq('event_id', eventId);

    if (activeOnly) q = q.eq('active', true) as typeof q;

    const { data, error } = await q.order('role').order('rating', { ascending: false });
    if (error) throw new BadRequestException(error.message);
    return (data ?? []).map((r) => this.map(r as Record<string, unknown>));
  }

  // ── List qualifications for a person ─────────────────────────────────────────

  async listForPerson(eventId: string, personId: string): Promise<RefereeQualification[]> {
    const { data, error } = await this.supabase.service
      .from('referee_qualifications')
      .select('*')
      .eq('event_id', eventId)
      .eq('person_id', personId)
      .eq('active', true);

    if (error) throw new BadRequestException(error.message);
    return (data ?? []).map((r) => this.map(r as Record<string, unknown>));
  }

  // ── Create or update qualification ───────────────────────────────────────────

  async upsert(
    eventId: string,
    personId: string,
    role: string,
    rating: number | null,
  ): Promise<RefereeQualification> {
    // Validate role refers to an existing skill that's usable for this event.
    const { data: skill, error: skillError } = await this.supabase.service
      .from('referee_skills')
      .select('id, is_system, event_id')
      .eq('id', role)
      .maybeSingle();

    if (skillError) throw new BadRequestException(skillError.message);
    if (!skill) throw new BadRequestException(`Invalid role: ${role}`);
    const skillRow = skill as { id: string; is_system: boolean; event_id: string | null };
    if (!skillRow.is_system && skillRow.event_id !== eventId) {
      throw new BadRequestException(`Skill '${role}' is not available for this event`);
    }

    if (rating !== null && (rating < 1 || rating > 5)) {
      throw new BadRequestException('Rating must be 1..5 or null');
    }

    // Check for existing active qualification for this role
    const { data: existing } = await this.supabase.service
      .from('referee_qualifications')
      .select('id')
      .eq('event_id', eventId)
      .eq('person_id', personId)
      .eq('role', role)
      .eq('active', true)
      .maybeSingle();

    if (existing) {
      // Update existing
      const { data, error } = await this.supabase.service
        .from('referee_qualifications')
        .update({ rating, updated_at: new Date().toISOString() })
        .eq('id', (existing as { id: string }).id)
        .select('*')
        .single();

      if (error) throw new BadRequestException(error.message);
      return this.map(data as Record<string, unknown>);
    }

    // Check max 3 active qualifications (one per role)
    const { count } = await this.supabase.service
      .from('referee_qualifications')
      .select('id', { count: 'exact', head: true })
      .eq('event_id', eventId)
      .eq('person_id', personId)
      .eq('active', true);

    if ((count ?? 0) >= 3) {
      throw new ConflictException(
        'A person can have at most 3 active qualifications (one per role)',
      );
    }

    const { data, error } = await this.supabase.service
      .from('referee_qualifications')
      .insert({
        event_id: eventId,
        person_id: personId,
        role,
        rating,
        active: true,
      })
      .select('*')
      .single();

    if (error) throw new BadRequestException(error.message);
    return this.map(data as Record<string, unknown>);
  }

  // ── Soft delete ───────────────────────────────────────────────────────────────

  async deactivate(qualificationId: string): Promise<void> {
    const { data } = await this.supabase.service
      .from('referee_qualifications')
      .select('id')
      .eq('id', qualificationId)
      .maybeSingle();

    if (!data) throw new NotFoundException(`Qualification ${qualificationId} not found`);

    await this.supabase.service
      .from('referee_qualifications')
      .update({ active: false, updated_at: new Date().toISOString() })
      .eq('id', qualificationId);
  }

  // ── Skills catalog ────────────────────────────────────────────────────────────

  /** List system skills + the event's custom skills, sorted by isSystem desc, sortOrder asc. */
  async listEventSkills(eventId: string): Promise<RefereeSkill[]> {
    const { data, error } = await this.supabase.service
      .from('referee_skills')
      .select('*')
      .or(`is_system.eq.true,event_id.eq.${eventId}`)
      .order('is_system', { ascending: false })
      .order('sort_order', { ascending: true });

    if (error) throw new BadRequestException(error.message);
    return (data ?? []).map((r) => this.mapSkill(r as Record<string, unknown>));
  }

  /** Create a custom skill for this event. */
  async createCustomSkill(
    eventId: string,
    dto: CreateRefereeSkillDto,
    userId: string,
  ): Promise<RefereeSkill> {
    const event = await this.getEvent(eventId);
    await this.organizations.assertOrgRole(event.organization_id, userId, 'admin');

    const shortEventId = eventId.replace(/-/g, '').slice(0, 8);
    const nonce = randomUUID().replace(/-/g, '').slice(0, 6);
    const id = `custom-${shortEventId}-${nonce}`;

    const { data, error } = await this.supabase.service
      .from('referee_skills')
      .insert({
        id,
        event_id: eventId,
        name: dto.name,
        color: dto.color,
        is_system: false,
        sort_order: 0,
      })
      .select('*')
      .single();

    if (error) throw new BadRequestException(error.message);
    return this.mapSkill(data as Record<string, unknown>);
  }

  /** Edit a custom skill. Refuses if is_system = true. */
  async updateCustomSkill(
    skillId: string,
    dto: UpdateRefereeSkillDto,
    userId: string,
  ): Promise<RefereeSkill> {
    const { data: existing, error: fetchError } = await this.supabase.service
      .from('referee_skills')
      .select('*')
      .eq('id', skillId)
      .maybeSingle();

    if (fetchError) throw new BadRequestException(fetchError.message);
    if (!existing) throw new NotFoundException(`Skill ${skillId} not found`);

    const row = existing as Record<string, unknown>;
    if (row['is_system']) {
      throw new ForbiddenException('System skills cannot be edited');
    }

    const event = await this.getEvent(row['event_id'] as string);
    await this.organizations.assertOrgRole(event.organization_id, userId, 'admin');

    const updates: { name?: string; color?: string; updated_at: string } = {
      updated_at: new Date().toISOString(),
    };
    if (dto.name !== undefined) updates.name = dto.name;
    if (dto.color !== undefined) updates.color = dto.color;

    const { data, error } = await this.supabase.service
      .from('referee_skills')
      .update(updates)
      .eq('id', skillId)
      .select('*')
      .single();

    if (error) throw new BadRequestException(error.message);
    return this.mapSkill(data as Record<string, unknown>);
  }

  /** Delete a custom skill. Refuses if is_system = true or active qualifications reference it. */
  async deleteCustomSkill(skillId: string, userId: string): Promise<void> {
    const { data: existing, error: fetchError } = await this.supabase.service
      .from('referee_skills')
      .select('*')
      .eq('id', skillId)
      .maybeSingle();

    if (fetchError) throw new BadRequestException(fetchError.message);
    if (!existing) throw new NotFoundException(`Skill ${skillId} not found`);

    const row = existing as Record<string, unknown>;
    if (row['is_system']) {
      throw new ForbiddenException('System skills cannot be deleted');
    }

    const event = await this.getEvent(row['event_id'] as string);
    await this.organizations.assertOrgRole(event.organization_id, userId, 'admin');

    // Check active qualifications referencing this skill (role = skillId, active = true)
    const { count, error: countError } = await this.supabase.service
      .from('referee_qualifications')
      .select('id', { count: 'exact', head: true })
      .eq('role', skillId)
      .eq('active', true);

    if (countError) throw new BadRequestException(countError.message);

    const activeCount = count ?? 0;
    if (activeCount > 0) {
      throw new ConflictException(
        `Cannot delete skill: ${activeCount} active qualification(s) still reference it`,
      );
    }

    const { error } = await this.supabase.service.from('referee_skills').delete().eq('id', skillId);

    if (error) throw new BadRequestException(error.message);
  }

  // ── Task 3: Event referees ────────────────────────────────────────────────────

  /**
   * Idempotently register a user as a referee for an event.
   * - Upserts event_referees row (ON CONFLICT DO NOTHING).
   * - Best-effort sets global_persons.is_referee = 'true' for the linked profile.
   * - Never clears is_referee.
   */
  async ensureEventReferee(
    eventId: string,
    targetUserId: string,
    actorUserId: string,
  ): Promise<void> {
    const event = await this.getEvent(eventId);
    await this.organizations.assertOrgRole(event.organization_id, actorUserId, 'admin');

    // Defense in depth: verify targetUserId is linked to a claimed global_person.
    // The UI gates on claimed_by_user_id being non-null, but a malicious caller
    // could still POST an arbitrary UUID and silently corrupt event_referees.
    const { data: claimed, error: claimedErr } = await this.supabase.service
      .from('global_persons')
      .select('id, is_referee')
      .eq('claimed_by_user_id', targetUserId)
      .limit(1)
      .maybeSingle();

    if (claimedErr) throw new BadRequestException(claimedErr.message);
    if (!claimed) {
      throw new BadRequestException(
        `User ${targetUserId} is not linked to a claimed global profile.`,
      );
    }

    // Upsert event_referees row — idempotent via ON CONFLICT DO NOTHING
    const { error: upsertError } = await this.supabase.service.from('event_referees').upsert(
      {
        event_id: eventId,
        user_id: targetUserId,
        available_all_tournaments: true,
        available_all_event_duration: true,
      },
      { onConflict: 'event_id,user_id', ignoreDuplicates: true },
    );

    if (upsertError) throw new BadRequestException(upsertError.message);

    // Promote the global is_referee flag iff it is currently NULL.
    // Provenance: record is_referee_event_managed = true so removeEventReferee
    // can safely clear the flag when the last event_referees row goes away.
    // Pre-existing referee tags (any non-NULL value) are preserved untouched.
    if ((claimed as { is_referee: string | null }).is_referee === null) {
      await this.supabase.service
        .from('global_persons')
        .update({
          is_referee: 'true',
          is_referee_event_managed: true,
          updated_at: new Date().toISOString(),
        })
        .eq('claimed_by_user_id', targetUserId)
        .is('is_referee', null);
      // Ignore error — best-effort only.
    }
  }

  /**
   * Remove a user as referee for an event.
   * - Deletes referee_assignments for (event, user) defensively.
   * - Deletes the event_referees row.
   * - If the global is_referee flag was set by an event promotion
   *   (is_referee_event_managed = true) AND no other event_referees row
   *   exists for this user, clear is_referee back to NULL.
   * - Idempotent: deleting a non-existent row is a no-op.
   */
  async removeEventReferee(
    eventId: string,
    targetUserId: string,
    actorUserId: string,
  ): Promise<void> {
    const event = await this.getEvent(eventId);
    await this.organizations.assertOrgRole(event.organization_id, actorUserId, 'admin');

    // Defensive cleanup: any referee_assignments scoped to this event for the
    // user should not outlive the event_referees row.
    await this.supabase.service
      .from('referee_assignments')
      .delete()
      .eq('event_id', eventId)
      .eq('user_id', targetUserId);

    const { error: delErr } = await this.supabase.service
      .from('event_referees')
      .delete()
      .eq('event_id', eventId)
      .eq('user_id', targetUserId);

    if (delErr) throw new BadRequestException(delErr.message);

    // Is this user still a referee at any other event?
    const { data: remaining, error: remErr } = await this.supabase.service
      .from('event_referees')
      .select('event_id')
      .eq('user_id', targetUserId)
      .limit(1);

    if (remErr) throw new BadRequestException(remErr.message);
    if (remaining && remaining.length > 0) return;

    // No remaining event_referees rows — clear the global flag IFF we set it.
    // The is_referee_event_managed guard preserves manually-set referee tags.
    await this.supabase.service
      .from('global_persons')
      .update({
        is_referee: null,
        is_referee_event_managed: false,
        updated_at: new Date().toISOString(),
      })
      .eq('claimed_by_user_id', targetUserId)
      .eq('is_referee_event_managed', true);
  }

  /**
   * Update availability flags for a referee at an event.
   * Upserts the event_referees row if missing (defaults: true/true).
   */
  async updateAvailability(
    eventId: string,
    targetUserId: string,
    dto: UpdateRefereeAvailabilityDto,
    actorUserId: string,
  ): Promise<void> {
    const event = await this.getEvent(eventId);
    await this.organizations.assertOrgRole(event.organization_id, actorUserId, 'admin');

    // Check if row exists
    const { data: existing } = await this.supabase.service
      .from('event_referees')
      .select('event_id')
      .eq('event_id', eventId)
      .eq('user_id', targetUserId)
      .maybeSingle();

    if (existing) {
      // Explicit allowlist — never spread dto directly
      const updates: {
        available_all_tournaments?: boolean;
        available_all_event_duration?: boolean;
        updated_at: string;
      } = { updated_at: new Date().toISOString() };
      if (dto.availableAllTournaments !== undefined)
        updates.available_all_tournaments = dto.availableAllTournaments;
      if (dto.availableAllEventDuration !== undefined)
        updates.available_all_event_duration = dto.availableAllEventDuration;

      const { error } = await this.supabase.service
        .from('event_referees')
        .update(updates)
        .eq('event_id', eventId)
        .eq('user_id', targetUserId);

      if (error) throw new BadRequestException(error.message);
    } else {
      // Row missing — insert with defaults + dto values applied
      const { error } = await this.supabase.service.from('event_referees').insert({
        event_id: eventId,
        user_id: targetUserId,
        available_all_tournaments: dto.availableAllTournaments ?? true,
        available_all_event_duration: dto.availableAllEventDuration ?? true,
      });

      if (error) throw new BadRequestException(error.message);
    }
  }

  /**
   * Enriched referees list for the Referees page.
   * Returns one EventRefereeRow per (event, user) in event_referees.
   */
  async listEventReferees(eventId: string, actorUserId: string): Promise<EventRefereeRow[]> {
    const event = await this.getEvent(eventId);
    // Read access: any org member (lowest role = read_only)
    await this.organizations.assertOrgRole(event.organization_id, actorUserId, 'read_only');

    // 1. Load event_referees rows
    const { data: refRows, error: refError } = await this.supabase.service
      .from('event_referees')
      .select('user_id, available_all_tournaments, available_all_event_duration')
      .eq('event_id', eventId);

    if (refError) throw new BadRequestException(refError.message);
    const rows = (refRows ?? []) as Array<{
      user_id: string;
      available_all_tournaments: boolean;
      available_all_event_duration: boolean;
    }>;

    if (rows.length === 0) return [];

    const userIds = rows.map((r) => r.user_id);

    // 2. Load active qualifications for this event (all users at once)
    const { data: qualRows, error: qualError } = await this.supabase.service
      .from('referee_qualifications')
      .select('user_id, role, rating')
      .eq('event_id', eventId)
      .eq('active', true)
      .in('user_id', userIds);

    if (qualError) throw new BadRequestException(qualError.message);
    const qualsByUser = new Map<string, Array<{ skillId: string; rating: number | null }>>();
    for (const q of (qualRows ?? []) as Array<{
      user_id: string;
      role: string;
      rating: number | null;
    }>) {
      const list = qualsByUser.get(q.user_id) ?? [];
      list.push({ skillId: q.role, rating: q.rating ?? null });
      qualsByUser.set(q.user_id, list);
    }

    // 3. Load global_persons for display name + club (best-effort via claimed_by_user_id)
    const { data: gpRows } = await this.supabase.service
      .from('global_persons')
      .select('id, claimed_by_user_id, given_name, family_name, display_name, club_id')
      .in('claimed_by_user_id', userIds);

    const gpByUser = new Map<
      string,
      {
        id: string;
        given_name: string;
        family_name: string;
        display_name: string;
        club_id: string | null;
      }
    >();
    for (const gp of (gpRows ?? []) as Array<{
      id: string;
      claimed_by_user_id: string;
      given_name: string;
      family_name: string;
      display_name: string;
      club_id: string | null;
    }>) {
      gpByUser.set(gp.claimed_by_user_id, gp);
    }

    // 4. Resolve club labels — best-effort: collect unique club_ids and batch-fetch names
    const clubIds = Array.from(
      new Set(
        (gpRows ?? [])
          .map((p: { club_id: string | null }) => p.club_id)
          .filter((id): id is string => Boolean(id)),
      ),
    );

    let clubsById = new Map<string, string>();
    if (clubIds.length) {
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

    // 5. Build assignment counts per user per tournament
    const assignmentMap = await this.countAssignmentsByReferee(eventId);

    // 6. Merge into EventRefereeRow[]
    return rows.map((r) => {
      const gp = gpByUser.get(r.user_id);
      const personId = gp?.id ?? null;
      const displayName = gp
        ? `${gp.given_name} ${gp.family_name}`.trim() || gp.display_name || r.user_id
        : r.user_id;

      const qualifications = qualsByUser.get(r.user_id) ?? [];
      const userAssignments = assignmentMap.get(r.user_id);

      const assignments: Array<{
        tournamentId: string;
        tournamentName: string;
        matchCount: number;
      }> = [];
      let totalMatchCount = 0;

      if (userAssignments) {
        for (const [tournamentId, info] of userAssignments.byTournament) {
          assignments.push({
            tournamentId,
            tournamentName: info.tournamentName,
            matchCount: info.count,
          });
          totalMatchCount += info.count;
        }
      }

      return {
        userId: r.user_id,
        personId,
        displayName,
        clubLabel: gp?.club_id ? (clubsById.get(gp.club_id) ?? null) : null,
        qualifications,
        availableAllTournaments: r.available_all_tournaments,
        availableAllEventDuration: r.available_all_event_duration,
        assignments,
        totalMatchCount,
      };
    });
  }

  // ── Private helpers ───────────────────────────────────────────────────────────

  private async getEvent(eventId: string): Promise<{ id: string; organization_id: string }> {
    const { data, error } = await this.supabase.service
      .from('events')
      .select('id, organization_id')
      .eq('id', eventId)
      .maybeSingle();

    if (error) throw new BadRequestException(error.message);
    if (!data) throw new NotFoundException(`Event ${eventId} not found`);
    return data as { id: string; organization_id: string };
  }

  /**
   * Aggregate per-referee, per-tournament match counts across all assignment sources.
   *
   * Data sources:
   *   1. referee_assignments rows (scope_type = 'match' | 'pool')
   *      - 'match' → single match; tournament resolved via match → phase → tournament
   *      - 'pool'  → all matches in that pool; tournament resolved via pool → phase → tournament
   *   2. matches.referee_id (event-scoped persons.id, not user_id)
   *      → resolved to user_id via persons.claimed_by_user_id (best-effort)
   *
   * Deduplication: a (matchId, userId) pair is counted at most once across both sources.
   */
  private async countAssignmentsByReferee(
    eventId: string,
  ): Promise<
    Map<
      string,
      { byTournament: Map<string, { tournamentName: string; count: number }>; totalMatches: number }
    >
  > {
    const result = new Map<
      string,
      { byTournament: Map<string, { tournamentName: string; count: number }>; totalMatches: number }
    >();

    // ── Step 1: resolve phases → tournaments for this event ───────────────────
    const { data: tournamentRows, error: tErr } = await this.supabase.service
      .from('tournaments')
      .select('id, name')
      .eq('event_id', eventId);

    if (tErr) throw new BadRequestException(tErr.message);
    const tournaments = (tournamentRows ?? []) as Array<{ id: string; name: string }>;
    if (tournaments.length === 0) return result;

    const tournamentIds = tournaments.map((t) => t.id);
    const tournamentNameById = new Map(tournaments.map((t) => [t.id, t.name]));

    const { data: phaseRows, error: phErr } = await this.supabase.service
      .from('phases')
      .select('id, tournament_id')
      .in('tournament_id', tournamentIds);

    if (phErr) throw new BadRequestException(phErr.message);
    const phases = (phaseRows ?? []) as Array<{ id: string; tournament_id: string }>;
    const phaseToTournament = new Map(phases.map((p) => [p.id, p.tournament_id]));
    const phaseIds = phases.map((p) => p.id);

    if (phaseIds.length === 0) return result;

    // ── Step 2: load pools → resolve pool → tournament ────────────────────────
    const { data: poolRows, error: plErr } = await this.supabase.service
      .from('pools')
      .select('id, phase_id')
      .in('phase_id', phaseIds);

    if (plErr) throw new BadRequestException(plErr.message);
    const pools = (poolRows ?? []) as Array<{ id: string; phase_id: string }>;
    const poolToTournament = new Map<string, string>();
    for (const pool of pools) {
      const tid = phaseToTournament.get(pool.phase_id);
      if (tid) poolToTournament.set(pool.id, tid);
    }

    // ── Step 3: load matches (for dedup set + referee_id source) ─────────────
    const { data: matchRows, error: mErr } = await this.supabase.service
      .from('matches')
      .select('id, phase_id, pool_id, referee_id')
      .in('phase_id', phaseIds);

    if (mErr) throw new BadRequestException(mErr.message);
    const matches = (matchRows ?? []) as Array<{
      id: string;
      phase_id: string;
      pool_id: string | null;
      referee_id: string | null;
    }>;

    const matchToTournament = new Map<string, string>();
    for (const m of matches) {
      const tid = phaseToTournament.get(m.phase_id);
      if (tid) matchToTournament.set(m.id, tid);
    }

    // ── Step 4: load persons with claimed_by_user_id for referee_id resolution ─
    // Only needed if any match has referee_id set
    const matchesWithRefereeId = matches.filter((m) => m.referee_id !== null);
    const personToUser = new Map<string, string>(); // person_id → user_id

    if (matchesWithRefereeId.length > 0) {
      const personIds = [...new Set(matchesWithRefereeId.map((m) => m.referee_id as string))];
      const { data: personRows } = await this.supabase.service
        .from('persons')
        .select('id, claimed_by_user_id')
        .in('id', personIds)
        .not('claimed_by_user_id', 'is', null);

      for (const p of (personRows ?? []) as Array<{
        id: string;
        claimed_by_user_id: string | null;
      }>) {
        if (p.claimed_by_user_id) personToUser.set(p.id, p.claimed_by_user_id);
      }
    }

    // ── Step 5: load referee_assignments for this event ───────────────────────
    const { data: assignmentRows, error: aErr } = await this.supabase.service
      .from('referee_assignments')
      .select('user_id, scope_type, pool_id, match_id')
      .eq('event_id', eventId)
      // 'lice' scope assignments are intentionally excluded: they cover a full session/day,
      // not a determinate match list, so they don't contribute to per-tournament match counts.
      // Per-lice referee work is surfaced separately (out of scope for v1 Referees list).
      .in('scope_type', ['pool', 'match']);

    if (aErr) throw new BadRequestException(aErr.message);
    const assignments = (assignmentRows ?? []) as Array<{
      user_id: string;
      scope_type: string;
      pool_id: string | null;
      match_id: string | null;
    }>;

    // ── Step 6: count matches per pool (for pool-scoped assignments) ──────────
    const matchesPerPool = new Map<string, string[]>(); // pool_id → match_ids
    for (const m of matches) {
      if (m.pool_id) {
        const list = matchesPerPool.get(m.pool_id) ?? [];
        list.push(m.id);
        matchesPerPool.set(m.pool_id, list);
      }
    }

    // ── Step 7: accumulate counts with deduplication ──────────────────────────
    // Key: `${matchId}:${userId}`
    const seen = new Set<string>();

    const addCount = (userId: string, matchId: string, tournamentId: string) => {
      const key = `${matchId}:${userId}`;
      if (seen.has(key)) return;
      seen.add(key);

      let userEntry = result.get(userId);
      if (!userEntry) {
        userEntry = { byTournament: new Map(), totalMatches: 0 };
        result.set(userId, userEntry);
      }
      const tName = tournamentNameById.get(tournamentId) ?? tournamentId;
      const tEntry = userEntry.byTournament.get(tournamentId) ?? {
        tournamentName: tName,
        count: 0,
      };
      tEntry.count += 1;
      userEntry.byTournament.set(tournamentId, tEntry);
      userEntry.totalMatches += 1;
    };

    // Source A: referee_assignments
    for (const a of assignments) {
      const userId = a.user_id;
      if (a.scope_type === 'match' && a.match_id) {
        const tid = matchToTournament.get(a.match_id);
        if (tid) addCount(userId, a.match_id, tid);
      } else if (a.scope_type === 'pool' && a.pool_id) {
        const tid = poolToTournament.get(a.pool_id);
        if (!tid) continue;
        const poolMatchIds = matchesPerPool.get(a.pool_id) ?? [];
        for (const matchId of poolMatchIds) {
          addCount(userId, matchId, tid);
        }
      }
    }

    // Source B: matches.referee_id (resolved to user_id via persons)
    for (const m of matchesWithRefereeId) {
      const userId = personToUser.get(m.referee_id as string);
      if (!userId) continue;
      const tid = matchToTournament.get(m.id);
      if (!tid) continue;
      addCount(userId, m.id, tid);
    }

    return result;
  }

  private map(r: Record<string, unknown>): RefereeQualification {
    return {
      id: r['id'] as string,
      eventId: r['event_id'] as string,
      personId: r['person_id'] as string,
      role: r['role'] as RefereeRole,
      rating: (r['rating'] as number | null) ?? null,
      active: Boolean(r['active']),
      createdAt: r['created_at'] as string,
    };
  }

  private mapSkill(r: Record<string, unknown>): RefereeSkill {
    return {
      id: r['id'] as string,
      eventId: (r['event_id'] as string | null) ?? null,
      name: r['name'] as string,
      color: r['color'] as string,
      isSystem: Boolean(r['is_system']),
      sortOrder: (r['sort_order'] as number) ?? 0,
      createdAt: r['created_at'] as string,
      updatedAt: r['updated_at'] as string,
    };
  }
}
