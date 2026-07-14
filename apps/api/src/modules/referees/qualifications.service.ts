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
  /** R4: free-text tooltip / subtitle. Empty string when unset. */
  description: string;
  /**
   * Per-event "hidden" flag (Slice 6 of the referees overhaul). True when
   * an `event_hidden_skills` row exists for (eventId, this skill). The
   * row-level columns on `referee_skills` stay event-agnostic — this flag
   * is composed at read time inside `listEventSkills`.
   */
  isHidden: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateRefereeSkillDto {
  name: string;
  color: string;
  description?: string;
}

export interface UpdateRefereeSkillDto {
  name?: string;
  color?: string;
  /** R4: editable on system skills (rename/colour still blocked). */
  description?: string;
  /** R4: editable on system skills (used by drag-reorder). */
  sortOrder?: number;
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
  /**
   * Slice 8: explicit tournament allowlist. When present, replaces the
   * referee's entire tournament-availability set. Mutually compatible
   * with the boolean above — pass either to update that dimension.
   */
  tournamentIds?: string[];
  /** Slice 8: explicit day-index allowlist (0 = event start_date). */
  dayIndices?: number[];
}

export interface EventRefereeRow {
  /**
   * Post-0063: personId is the canonical key. userId is a derived display
   * field — resolved from global_persons.claimed_by_user_id — nullable when
   * the person hasn't claimed an account.
   */
  personId: string;
  userId: string | null;
  /** True when the person has not claimed an account yet (= userId is null). */
  unclaimed: boolean;
  displayName: string;
  clubLabel: string | null;
  qualifications: Array<{ skillId: string; rating: number | null }>;
  availableAllTournaments: boolean;
  availableAllEventDuration: boolean;
  /**
   * Slice 8: explicit per-tournament allowlist composed from
   * event_referee_tournaments. The boolean above is a derived shortcut
   * (true iff this list contains every tournament currently on the event).
   */
  tournamentIds: string[];
  /** Slice 8: explicit day-index allowlist (0 = event start_date). */
  dayIndices: number[];
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
    // Post-0063: referee_qualifications.person_id is a global_persons.id, not
    // a persons.id — so a `persons ( ... )` embed has no FK to resolve and
    // PostgREST 400s. The row mapper at the bottom of this file only reads
    // qualification columns anyway, so the embed was dead code.
    let q = this.supabase.service
      .from('referee_qualifications')
      .select('*')
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

    // Post-0063: referee_qualifications is keyed exclusively on person_id.
    // Look for an existing active qualification for this role.
    const { data: existing } = await this.supabase.service
      .from('referee_qualifications')
      .select('id')
      .eq('event_id', eventId)
      .eq('role', role)
      .eq('active', true)
      .eq('person_id', personId)
      .maybeSingle();

    if (existing) {
      const { data, error } = await this.supabase.service
        .from('referee_qualifications')
        .update({ rating, updated_at: new Date().toISOString() })
        .eq('id', (existing as { id: string }).id)
        .select('*')
        .single();

      if (error) throw new BadRequestException(error.message);
      return this.map(data as Record<string, unknown>);
    }

    // Max 3 active qualifications per person per event (one per role).
    const { count } = await this.supabase.service
      .from('referee_qualifications')
      .select('id', { count: 'exact', head: true })
      .eq('event_id', eventId)
      .eq('active', true)
      .eq('person_id', personId);

    if ((count ?? 0) >= 3) {
      throw new ConflictException(
        'A person can have at most 3 active qualifications (one per role)',
      );
    }

    const { data, error } = await this.supabase.service
      .from('referee_qualifications')
      .insert({ event_id: eventId, person_id: personId, role, rating, active: true })
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

    // Slice 6: compose isHidden per event from event_hidden_skills. Catalog
    // callers still need every skill (so they can render the toggle); the
    // active-only projection lives in listActiveEventSkills().
    const { data: hiddenRows, error: hiddenErr } = await this.supabase.service
      .from('event_hidden_skills')
      .select('skill_id')
      .eq('event_id', eventId);
    if (hiddenErr) throw new BadRequestException(hiddenErr.message);
    const hidden = new Set((hiddenRows ?? []).map((r) => (r as { skill_id: string }).skill_id));

    return (data ?? []).map((r) => {
      const skill = this.mapSkill(r as Record<string, unknown>);
      return { ...skill, isHidden: hidden.has(skill.id) };
    });
  }

  /** Active skills only — used by the assigner, role picker, and list column projection. */
  async listActiveEventSkills(eventId: string): Promise<RefereeSkill[]> {
    const all = await this.listEventSkills(eventId);
    return all.filter((s) => !s.isHidden);
  }

  /**
   * Hide or un-hide a skill for this event. Works for system skills too —
   * the row lives in the per-event join table, never on referee_skills,
   * so global rows stay shared.
   */
  async setSkillVisibility(
    eventId: string,
    skillId: string,
    isHidden: boolean,
    userId: string,
  ): Promise<void> {
    const event = await this.getEvent(eventId);
    await this.organizations.assertOrgRole(event.organization_id, userId, 'admin');

    if (isHidden) {
      const { error } = await this.supabase.service
        .from('event_hidden_skills')
        .upsert({ event_id: eventId, skill_id: skillId }, { onConflict: 'event_id,skill_id' });
      if (error) throw new BadRequestException(error.message);
    } else {
      const { error } = await this.supabase.service
        .from('event_hidden_skills')
        .delete()
        .eq('event_id', eventId)
        .eq('skill_id', skillId);
      if (error) throw new BadRequestException(error.message);
    }
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
        description: dto.description ?? '',
      })
      .select('*')
      .single();

    if (error) throw new BadRequestException(error.message);
    return this.mapSkill(data as Record<string, unknown>);
  }

  /**
   * Edit a skill. System skills are partially editable in R4:
   *   - description: allowed on both system + custom
   *   - sortOrder:   allowed on both (drag-reorder works on system skills too)
   *   - name, color: still blocked on system skills (existing invariant)
   *
   * Auth: system skills don't carry an event_id, so we require platform
   * super-admin gating for system-only writes. Custom skills require
   * org-admin on the owning event (existing behaviour).
   */
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
    const isSystem = row['is_system'] === true;

    // R4: system skills still block rename/recolour, but description +
    // sortOrder are user-editable across the catalog (incl. drag-reorder).
    if (isSystem && (dto.name !== undefined || dto.color !== undefined)) {
      throw new ForbiddenException('System skills cannot be renamed or recoloured');
    }

    // Auth: custom skills need org-admin on their event; system skills
    // (no event_id) gate through any event the caller is admin on (R4
    // exposes them via org-scoped UI, never as global edits).
    if (!isSystem) {
      const event = await this.getEvent(row['event_id'] as string);
      await this.organizations.assertOrgRole(event.organization_id, userId, 'admin');
    }

    const updates: {
      name?: string;
      color?: string;
      description?: string;
      sort_order?: number;
      updated_at: string;
    } = {
      updated_at: new Date().toISOString(),
    };
    if (dto.name !== undefined) updates.name = dto.name;
    if (dto.color !== undefined) updates.color = dto.color;
    if (dto.description !== undefined) updates.description = dto.description;
    if (dto.sortOrder !== undefined) updates.sort_order = dto.sortOrder;

    const { data, error } = await this.supabase.service
      .from('referee_skills')
      .update(updates)
      .eq('id', skillId)
      .select('*')
      .single();

    if (error) throw new BadRequestException(error.message);
    return this.mapSkill(data as Record<string, unknown>);
  }

  /**
   * R4: bulk drag-reorder. Accepts a list of skill IDs in their new
   * order; rewrites each skill's `sort_order` to its index. Operates
   * across both system + custom skills since the drag-reorder UI shows
   * them in one table.
   *
   * Org-admin gated on the event the IDs belong to. We pick the first
   * non-system skill in the input to establish the event for auth — if
   * the input is system-only, we accept the request (rare; super-admin
   * UI calling this is not a v1 expectation).
   */
  async reorderSkills(eventId: string, orderedSkillIds: string[], userId: string): Promise<void> {
    if (orderedSkillIds.length === 0) return;
    const event = await this.getEvent(eventId);
    await this.organizations.assertOrgRole(event.organization_id, userId, 'admin');

    // Persist each new sort_order in sequence. Single-row updates keep
    // the change small + each write is independent; in practice the
    // catalog has < 20 skills so the round-trip cost is negligible.
    for (let i = 0; i < orderedSkillIds.length; i++) {
      const id = orderedSkillIds[i]!;
      const { error } = await this.supabase.service
        .from('referee_skills')
        .update({ sort_order: i, updated_at: new Date().toISOString() })
        .eq('id', id);
      if (error) throw new BadRequestException(error.message);
    }
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

    // R4 of the staffing overhaul (migration 0060): a skill referenced by
    // a tournament_slot_allowed_skills or event_slot_config_default_skills
    // row would otherwise be blocked by ON DELETE RESTRICT at the FK level.
    // We count up front so the 409 message enumerates every blocker.
    const [{ count: slotTournamentCount, error: sErr1 }, { count: slotEventCount, error: sErr2 }] =
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
    if (sErr1) throw new BadRequestException(sErr1.message);
    if (sErr2) throw new BadRequestException(sErr2.message);

    const activeCount = count ?? 0;
    const slotCount = (slotTournamentCount ?? 0) + (slotEventCount ?? 0);
    if (activeCount > 0 || slotCount > 0) {
      const reasons: string[] = [];
      if (activeCount > 0) reasons.push(`${activeCount} active qualification(s)`);
      if (slotCount > 0) reasons.push(`${slotCount} staffing slot(s)`);
      throw new ConflictException(
        `Cannot delete skill: ${reasons.join(' and ')} still reference it`,
      );
    }

    const { error } = await this.supabase.service.from('referee_skills').delete().eq('id', skillId);

    if (error) throw new BadRequestException(error.message);
  }

  // ── Task 3: Event referees ────────────────────────────────────────────────────

  /**
   * Idempotently register a person as a referee for an event.
   *
   * Post-0063: event_referees keys exclusively on person_id (= global_persons.id).
   * Whether the person is claimed (auth-linked) or unclaimed makes no difference
   * here — the schema treats both identically. Claimed-vs-unclaimed only matters
   * at notification-dispatch time, where we need an email address.
   *
   * - Upserts event_referees row (ON CONFLICT DO NOTHING).
   * - Ticks global is_referee = true when the person is not already a referee.
   *   Tick-only: the flag is never auto-cleared (see removeEventReferee), so a
   *   person stays flagged as a referee even after leaving every roster.
   */
  async ensureEventReferee(eventId: string, personId: string, actorUserId: string): Promise<void> {
    const event = await this.getEvent(eventId);
    await this.organizations.assertOrgRole(event.organization_id, actorUserId, 'admin');

    // Try the canonical case first: personId is a global_persons.id.
    const { data: globalPerson, error: gpErr } = await this.supabase.service
      .from('global_persons')
      .select('id, is_referee')
      .eq('id', personId)
      .maybeSingle();
    if (gpErr) throw new BadRequestException(gpErr.message);

    let resolvedGlobalId: string | null = (globalPerson as { id: string } | null)?.id ?? null;
    let isRefereeRaw: boolean | string | null =
      (globalPerson as { is_referee: boolean | string | null } | null)?.is_referee ?? null;

    // Fallback: the caller may have passed an event-scoped persons.id (the
    // FE's lookup payload exposes both ids and the picker / participants-
    // page auto-add may pass either). Look the row up in `persons` and use
    // its global_person_id when set. If the row exists but the link is
    // null, surface a clearer error so the operator knows what to fix.
    if (!resolvedGlobalId) {
      const { data: personsRow, error: pErr } = await this.supabase.service
        .from('persons')
        .select('global_person_id, event_id')
        .eq('id', personId)
        .eq('event_id', eventId)
        .maybeSingle();
      if (pErr) throw new BadRequestException(pErr.message);

      const linkedGlobalId =
        (personsRow as { global_person_id: string | null } | null)?.global_person_id ?? null;
      if (linkedGlobalId) {
        resolvedGlobalId = linkedGlobalId;
        const { data: gp2 } = await this.supabase.service
          .from('global_persons')
          .select('is_referee')
          .eq('id', resolvedGlobalId)
          .maybeSingle();
        isRefereeRaw = (gp2 as { is_referee: boolean | string | null } | null)?.is_referee ?? null;
      } else if (personsRow) {
        throw new BadRequestException(
          `Participant ${personId} has no global profile — link or create one first.`,
        );
      }
    }

    if (!resolvedGlobalId) {
      throw new BadRequestException(`Global person ${personId} not found.`);
    }

    const { error: upsertError } = await this.supabase.service.from('event_referees').upsert(
      {
        event_id: eventId,
        person_id: resolvedGlobalId,
        available_all_tournaments: true,
        available_all_event_duration: true,
      },
      { onConflict: 'event_id,person_id', ignoreDuplicates: true },
    );

    if (upsertError) throw new BadRequestException(upsertError.message);

    const alreadyReferee = isRefereeRaw === true || isRefereeRaw === 'true';
    if (!alreadyReferee) {
      await this.supabase.service
        .from('global_persons')
        .update({
          is_referee: true,
          updated_at: new Date().toISOString(),
        })
        .eq('id', resolvedGlobalId);
    }
  }

  /**
   * Remove a person as referee for an event.
   * - Cascades referee_assignments cleanup defensively.
   * - Deletes the event_referees row.
   * - Tick-only: the global is_referee flag is intentionally left untouched, so a
   *   person keeps their referee tag after being removed from an event roster.
   */
  async removeEventReferee(eventId: string, personId: string, actorUserId: string): Promise<void> {
    const event = await this.getEvent(eventId);
    await this.organizations.assertOrgRole(event.organization_id, actorUserId, 'admin');

    await this.supabase.service
      .from('referee_assignments')
      .delete()
      .eq('event_id', eventId)
      .eq('person_id', personId);

    const { error: delErr } = await this.supabase.service
      .from('event_referees')
      .delete()
      .eq('event_id', eventId)
      .eq('person_id', personId);

    if (delErr) throw new BadRequestException(delErr.message);
  }

  /**
   * Update availability flags for a referee at an event.
   * Upserts the event_referees row if missing (defaults: true/true).
   */
  async updateAvailability(
    eventId: string,
    personId: string,
    dto: UpdateRefereeAvailabilityDto,
    actorUserId: string,
  ): Promise<void> {
    const event = await this.getEvent(eventId);
    await this.organizations.assertOrgRole(event.organization_id, actorUserId, 'admin');

    const { data: existing } = await this.supabase.service
      .from('event_referees')
      .select('event_id')
      .eq('event_id', eventId)
      .eq('person_id', personId)
      .maybeSingle();

    if (existing) {
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
        .eq('person_id', personId);

      if (error) throw new BadRequestException(error.message);
    } else {
      const { error } = await this.supabase.service.from('event_referees').insert({
        event_id: eventId,
        person_id: personId,
        available_all_tournaments: dto.availableAllTournaments ?? true,
        available_all_event_duration: dto.availableAllEventDuration ?? true,
      });

      if (error) throw new BadRequestException(error.message);
    }

    // Slice 8: explicit allowlists. When `tournamentIds` is present in the
    // dto, replace the entire tournament allowlist for this referee
    // (delete then insert). Same for `dayIndices`. Absent means "leave
    // alone" so individual booleans can still mutate independently.
    if (dto.tournamentIds !== undefined) {
      await this.supabase.service
        .from('event_referee_tournaments')
        .delete()
        .eq('event_id', eventId)
        .eq('person_id', personId);
      if (dto.tournamentIds.length > 0) {
        const { error } = await this.supabase.service.from('event_referee_tournaments').insert(
          dto.tournamentIds.map((tournamentId) => ({
            event_id: eventId,
            person_id: personId,
            tournament_id: tournamentId,
          })),
        );
        if (error) throw new BadRequestException(error.message);
      }
    }
    if (dto.dayIndices !== undefined) {
      await this.supabase.service
        .from('event_referee_days')
        .delete()
        .eq('event_id', eventId)
        .eq('person_id', personId);
      if (dto.dayIndices.length > 0) {
        const { error } = await this.supabase.service.from('event_referee_days').insert(
          dto.dayIndices.map((dayIndex) => ({
            event_id: eventId,
            person_id: personId,
            day_index: dayIndex,
          })),
        );
        if (error) throw new BadRequestException(error.message);
      }
    }
  }

  /**
   * Enriched referees list for the Referees page.
   * Returns one EventRefereeRow per (event, user) in event_referees.
   */
  async listEventReferees(eventId: string, actorUserId: string): Promise<EventRefereeRow[]> {
    const event = await this.getEvent(eventId);
    await this.organizations.assertOrgRole(event.organization_id, actorUserId, 'read_only');

    // 1. Load event_referees rows — post-0063, person_id is the only identity.
    const { data: refRows, error: refError } = await this.supabase.service
      .from('event_referees')
      .select('person_id, available_all_tournaments, available_all_event_duration')
      .eq('event_id', eventId);

    if (refError) throw new BadRequestException(refError.message);
    const rows = (refRows ?? []) as Array<{
      person_id: string;
      available_all_tournaments: boolean;
      available_all_event_duration: boolean;
    }>;

    if (rows.length === 0) return [];

    const personIds = rows.map((r) => r.person_id);

    // 2. Active qualifications for this event, keyed on person_id.
    const qualsByPerson = new Map<string, Array<{ skillId: string; rating: number | null }>>();
    const { data: qualRows, error: qualError } = await this.supabase.service
      .from('referee_qualifications')
      .select('person_id, role, rating')
      .eq('event_id', eventId)
      .eq('active', true)
      .in('person_id', personIds);
    if (qualError) throw new BadRequestException(qualError.message);
    for (const q of (qualRows ?? []) as Array<{
      person_id: string;
      role: string;
      rating: number | null;
    }>) {
      const list = qualsByPerson.get(q.person_id) ?? [];
      list.push({ skillId: q.role, rating: q.rating ?? null });
      qualsByPerson.set(q.person_id, list);
    }

    // 3. Display info from global_persons.
    const gpById = new Map<
      string,
      {
        id: string;
        claimed_by_user_id: string | null;
        given_name: string;
        family_name: string;
        display_name: string;
        club_id: string | null;
      }
    >();
    const { data: gpRows } = await this.supabase.service
      .from('global_persons')
      .select('id, claimed_by_user_id, given_name, family_name, display_name, club_id')
      .in('id', personIds);
    for (const gp of (gpRows ?? []) as Array<{
      id: string;
      claimed_by_user_id: string | null;
      given_name: string;
      family_name: string;
      display_name: string;
      club_id: string | null;
    }>) {
      gpById.set(gp.id, gp);
    }

    // 4. Club labels.
    const clubIds = Array.from(
      new Set(
        Array.from(gpById.values())
          .map((p) => p.club_id)
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

    // 5. Assignment counts per person per tournament.
    const assignmentMap = await this.countAssignmentsByReferee(eventId);

    // 6. Slice 8: granular per-tournament + per-day allowlists.
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

    // 7. Coalesce the per-referee allowlists against the legacy
    //    "available_all_*" booleans. The booleans are the operator's
    //    intent; the join tables are a backfilled index. If a
    //    tournament was added after the backfill, the join row
    //    doesn't exist for it — so a referee marked "all
    //    tournaments" sees the chip picker render the OLD subset
    //    instead of the compact "✓ All tournaments" pill. Expand
    //    the array here so the frontend's auto-collapse fires.
    const { data: allTournamentRows } = await this.supabase.service
      .from('tournaments')
      .select('id')
      .eq('event_id', eventId);
    const allTournamentIds = ((allTournamentRows ?? []) as Array<{ id: string }>).map((t) => t.id);

    const { data: eventDates } = await this.supabase.service
      .from('events')
      .select('start_date, end_date')
      .eq('id', eventId)
      .maybeSingle();
    const start = (eventDates as { start_date?: string | null } | null)?.start_date ?? null;
    const end = (eventDates as { end_date?: string | null } | null)?.end_date ?? start;
    let numDays = 0;
    if (start) {
      const startMs = Date.parse(`${start}T00:00:00Z`);
      const endMs = Date.parse(`${end ?? start}T00:00:00Z`);
      if (!Number.isNaN(startMs) && !Number.isNaN(endMs)) {
        numDays = Math.max(1, Math.floor((endMs - startMs) / 86_400_000) + 1);
      }
    }
    const allDayIndices = Array.from({ length: numDays }, (_, i) => i);

    return rows.map((r) => {
      const gp = gpById.get(r.person_id) ?? null;
      const displayName = gp
        ? `${gp.given_name} ${gp.family_name}`.trim() || gp.display_name || r.person_id
        : r.person_id;
      const qualifications = qualsByPerson.get(r.person_id) ?? [];
      const personAssignments = assignmentMap.get(r.person_id);

      const assignments: Array<{
        tournamentId: string;
        tournamentName: string;
        matchCount: number;
      }> = [];
      let totalMatchCount = 0;

      if (personAssignments) {
        for (const [tournamentId, info] of personAssignments.byTournament) {
          assignments.push({
            tournamentId,
            tournamentName: info.tournamentName,
            matchCount: info.count,
          });
          totalMatchCount += info.count;
        }
      }

      const clubId = gp?.club_id ?? null;
      const claimedUserId = gp?.claimed_by_user_id ?? null;
      return {
        personId: r.person_id,
        userId: claimedUserId,
        unclaimed: claimedUserId === null,
        displayName,
        clubLabel: clubId ? (clubsById.get(clubId) ?? null) : null,
        qualifications,
        availableAllTournaments: r.available_all_tournaments,
        availableAllEventDuration: r.available_all_event_duration,
        tournamentIds: r.available_all_tournaments
          ? allTournamentIds
          : (tournamentsByPerson.get(r.person_id) ?? []),
        dayIndices: r.available_all_event_duration
          ? allDayIndices
          : (daysByPerson.get(r.person_id) ?? []),
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

    // ── Step 4: resolve matches.referee_id (event-scoped persons.id) → global_persons.id ─
    // Source B keys assignments via the legacy matches.referee_id column. Post-0063
    // we count everything on person_id (= global_persons.id), so resolve through
    // persons.global_person_id.
    const matchesWithRefereeId = matches.filter((m) => m.referee_id !== null);
    const personToGlobal = new Map<string, string>(); // persons.id → global_persons.id

    if (matchesWithRefereeId.length > 0) {
      const referePersonIds = [...new Set(matchesWithRefereeId.map((m) => m.referee_id as string))];
      const { data: personRows } = await this.supabase.service
        .from('persons')
        .select('id, global_person_id')
        .in('id', referePersonIds)
        .not('global_person_id', 'is', null);

      for (const p of (personRows ?? []) as Array<{
        id: string;
        global_person_id: string | null;
      }>) {
        if (p.global_person_id) personToGlobal.set(p.id, p.global_person_id);
      }
    }

    // ── Step 5: load referee_assignments for this event ───────────────────────
    const { data: assignmentRows, error: aErr } = await this.supabase.service
      .from('referee_assignments')
      .select('person_id, scope_type, pool_id, match_id')
      .eq('event_id', eventId)
      // 'lice' scope assignments are intentionally excluded: they cover a full session/day,
      // not a determinate match list, so they don't contribute to per-tournament match counts.
      .in('scope_type', ['pool', 'match']);

    if (aErr) throw new BadRequestException(aErr.message);
    const assignments = (assignmentRows ?? []) as Array<{
      person_id: string;
      scope_type: string;
      pool_id: string | null;
      match_id: string | null;
    }>;

    // ── Step 6: matches per pool (for pool-scoped assignments) ────────────────
    const matchesPerPool = new Map<string, string[]>();
    for (const m of matches) {
      if (m.pool_id) {
        const list = matchesPerPool.get(m.pool_id) ?? [];
        list.push(m.id);
        matchesPerPool.set(m.pool_id, list);
      }
    }

    // ── Step 7: accumulate counts with deduplication ──────────────────────────
    // Key: `${matchId}:${personId}` — counts each match at most once per referee.
    const seen = new Set<string>();

    const addCount = (personId: string, matchId: string, tournamentId: string) => {
      const key = `${matchId}:${personId}`;
      if (seen.has(key)) return;
      seen.add(key);

      let entry = result.get(personId);
      if (!entry) {
        entry = { byTournament: new Map(), totalMatches: 0 };
        result.set(personId, entry);
      }
      const tName = tournamentNameById.get(tournamentId) ?? tournamentId;
      const tEntry = entry.byTournament.get(tournamentId) ?? {
        tournamentName: tName,
        count: 0,
      };
      tEntry.count += 1;
      entry.byTournament.set(tournamentId, tEntry);
      entry.totalMatches += 1;
    };

    // Source A: referee_assignments (person_id-keyed post-0063).
    for (const a of assignments) {
      if (a.scope_type === 'match' && a.match_id) {
        const tid = matchToTournament.get(a.match_id);
        if (tid) addCount(a.person_id, a.match_id, tid);
      } else if (a.scope_type === 'pool' && a.pool_id) {
        const tid = poolToTournament.get(a.pool_id);
        if (!tid) continue;
        const poolMatchIds = matchesPerPool.get(a.pool_id) ?? [];
        for (const matchId of poolMatchIds) {
          addCount(a.person_id, matchId, tid);
        }
      }
    }

    // Source B: matches.referee_id (resolved to global person_id via persons).
    for (const m of matchesWithRefereeId) {
      const personId = personToGlobal.get(m.referee_id as string);
      if (!personId) continue;
      const tid = matchToTournament.get(m.id);
      if (!tid) continue;
      addCount(personId, m.id, tid);
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
      description: typeof r['description'] === 'string' ? (r['description'] as string) : '',
      // Default false — listEventSkills overrides with per-event lookup.
      isHidden: false,
      createdAt: r['created_at'] as string,
      updatedAt: r['updated_at'] as string,
    };
  }
}
