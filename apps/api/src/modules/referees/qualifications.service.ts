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
}

export interface EventRefereeRow {
  /**
   * R6: nullable for unclaimed referees. Claimed people have a non-null
   * userId; unclaimed ones expose only personId. Frontend uses personId
   * as the stable identity key for routing assignments.
   */
  userId: string | null;
  personId: string | null;
  /** R6: true when the row is keyed by person_id (= no claimed account). */
  unclaimed: boolean;
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

    // R6: figure out which identity column the person uses in this
    // event. Claimed referees have an event_referees row keyed by
    // user_id; unclaimed ones (post-R6) are keyed by person_id. We
    // mirror that decision on the referee_qualifications write.
    const identity = await this.resolveRefereeIdentity(eventId, personId);

    // Check for existing active qualification for this role.
    const existingQuery = this.supabase.service
      .from('referee_qualifications')
      .select('id')
      .eq('event_id', eventId)
      .eq('role', role)
      .eq('active', true);
    const { data: existing } = await (
      identity.column === 'user_id'
        ? existingQuery.eq('user_id', identity.value)
        : existingQuery.eq('person_id', identity.value)
    ).maybeSingle();

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

    // Check max 3 active qualifications (one per role).
    const countQuery = this.supabase.service
      .from('referee_qualifications')
      .select('id', { count: 'exact', head: true })
      .eq('event_id', eventId)
      .eq('active', true);
    const { count } = await (identity.column === 'user_id'
      ? countQuery.eq('user_id', identity.value)
      : countQuery.eq('person_id', identity.value));

    if ((count ?? 0) >= 3) {
      throw new ConflictException(
        'A person can have at most 3 active qualifications (one per role)',
      );
    }

    const insertRow: Record<string, unknown> = {
      event_id: eventId,
      role,
      rating,
      active: true,
    };
    insertRow[identity.column] = identity.value;
    const { data, error } = await this.supabase.service
      .from('referee_qualifications')
      .insert(insertRow)
      .select('*')
      .single();

    if (error) throw new BadRequestException(error.message);
    return this.map(data as Record<string, unknown>);
  }

  /**
   * R6: resolve the referee identity column for an event_referees row.
   * Given a `personId` (= global_persons.id), look up the matching
   * event_referees row. Returns either `{ column: 'user_id', value: userId }`
   * (claimed) or `{ column: 'person_id', value: personId }` (unclaimed).
   *
   * Falls back to `person_id` keying for legacy callers passing a
   * person_id without an event_referees row yet — qualifying without
   * first being on the referee roster is unusual but possible.
   */
  private async resolveRefereeIdentity(
    eventId: string,
    personId: string,
  ): Promise<{ column: 'user_id' | 'person_id'; value: string }> {
    // 1. Try claimed path: persons.id → claimed_by_user_id → event_referees.user_id.
    const { data: gp } = await this.supabase.service
      .from('global_persons')
      .select('claimed_by_user_id')
      .eq('id', personId)
      .maybeSingle();
    const claimedUserId = (gp as { claimed_by_user_id: string | null } | null)?.claimed_by_user_id;
    if (claimedUserId) {
      const { data: er } = await this.supabase.service
        .from('event_referees')
        .select('user_id')
        .eq('event_id', eventId)
        .eq('user_id', claimedUserId)
        .maybeSingle();
      if (er) return { column: 'user_id', value: claimedUserId };
    }
    // 2. Unclaimed path: event_referees.person_id = personId.
    return { column: 'person_id', value: personId };
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
   * R6: register an UNCLAIMED person as referee for an event.
   *
   * Keys the event_referees row by `person_id` (= global_persons.id)
   * instead of `user_id`. Refuses if the person already has a
   * claimed_by_user_id — the caller must use the user_id variant in
   * that case (steers double-write attempts to the canonical row).
   *
   * - Upserts event_referees row keyed on (event_id, person_id).
   * - Promotes the global is_referee flag (works the same way for
   *   claimed + unclaimed people — the column lives on global_persons,
   *   not on the user).
   * - On a later claim, `backfillRefereeIdentity` flips this row's
   *   `person_id` → NULL and sets `user_id`, joining the claimed path.
   */
  async ensureEventRefereeByPerson(
    eventId: string,
    personId: string,
    actorUserId: string,
  ): Promise<void> {
    const event = await this.getEvent(eventId);
    await this.organizations.assertOrgRole(event.organization_id, actorUserId, 'admin');

    // Verify the global_person exists and is genuinely unclaimed.
    const { data: person, error: personErr } = await this.supabase.service
      .from('global_persons')
      .select('id, claimed_by_user_id, is_referee')
      .eq('id', personId)
      .maybeSingle();

    if (personErr) throw new BadRequestException(personErr.message);
    if (!person) {
      throw new BadRequestException(`Global person ${personId} not found.`);
    }
    const personRow = person as {
      id: string;
      claimed_by_user_id: string | null;
      is_referee: string | null;
    };
    if (personRow.claimed_by_user_id) {
      throw new BadRequestException(
        `Person ${personId} already has a claimed account — use the user_id endpoint.`,
      );
    }

    // Upsert event_referees row keyed on (event_id, person_id). The
    // partial UNIQUE index on (event_id, person_id) WHERE person_id IS
    // NOT NULL provides the on-conflict target.
    const { error: upsertError } = await this.supabase.service.from('event_referees').upsert(
      {
        event_id: eventId,
        person_id: personId,
        user_id: null,
        available_all_tournaments: true,
        available_all_event_duration: true,
      },
      { onConflict: 'event_id,person_id', ignoreDuplicates: true },
    );

    if (upsertError) throw new BadRequestException(upsertError.message);

    // Same is_referee promotion rule as the claimed path.
    if (personRow.is_referee === null) {
      await this.supabase.service
        .from('global_persons')
        .update({
          is_referee: 'true',
          is_referee_event_managed: true,
          updated_at: new Date().toISOString(),
        })
        .eq('id', personId)
        .is('is_referee', null);
    }
  }

  /**
   * R6: remove an UNCLAIMED person from an event's referee roster.
   * Mirrors `removeEventReferee` but keys on `person_id`. Cleans up
   * any person-scoped referee_assignments + qualifications + the
   * event_referees row. Clears the global is_referee flag IFF we set
   * it AND no other event still has them as a referee.
   */
  async removeEventRefereeByPerson(
    eventId: string,
    personId: string,
    actorUserId: string,
  ): Promise<void> {
    const event = await this.getEvent(eventId);
    await this.organizations.assertOrgRole(event.organization_id, actorUserId, 'admin');

    // Defensive cleanup, person-keyed.
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

    // Still a referee at any other event?
    const { data: remaining, error: remErr } = await this.supabase.service
      .from('event_referees')
      .select('event_id')
      .eq('person_id', personId)
      .limit(1);

    if (remErr) throw new BadRequestException(remErr.message);
    if (remaining && remaining.length > 0) return;

    await this.supabase.service
      .from('global_persons')
      .update({
        is_referee: null,
        is_referee_event_managed: false,
        updated_at: new Date().toISOString(),
      })
      .eq('id', personId)
      .eq('is_referee_event_managed', true);
  }

  /**
   * R6: claim back-fill. When a global_person transitions from
   * unclaimed → claimed (their `claimed_by_user_id` becomes non-null),
   * flip any pre-existing person-keyed referee rows to user-keyed so
   * the rest of the system sees them as a normal claimed referee.
   *
   * Idempotent — re-running on already-claimed rows is a no-op since
   * the WHERE clause matches only rows where `person_id` is still set.
   * Best-effort: one of the three tables failing doesn't roll back the
   * others. The caller (onboarding service) should log + alert rather
   * than refuse the claim.
   */
  async backfillRefereeIdentity(personId: string, newUserId: string): Promise<void> {
    const now = new Date().toISOString();

    // event_referees
    await this.supabase.service
      .from('event_referees')
      .update({ user_id: newUserId, person_id: null, updated_at: now })
      .eq('person_id', personId);

    // referee_qualifications
    await this.supabase.service
      .from('referee_qualifications')
      .update({ user_id: newUserId, person_id: null, updated_at: now })
      .eq('person_id', personId);

    // referee_assignments — no updated_at column on this table.
    await this.supabase.service
      .from('referee_assignments')
      .update({ user_id: newUserId, person_id: null })
      .eq('person_id', personId);
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

    // 1. Load event_referees rows — R6: rows may carry user_id OR person_id.
    const { data: refRows, error: refError } = await this.supabase.service
      .from('event_referees')
      .select('user_id, person_id, available_all_tournaments, available_all_event_duration')
      .eq('event_id', eventId);

    if (refError) throw new BadRequestException(refError.message);
    const rows = (refRows ?? []) as Array<{
      user_id: string | null;
      person_id: string | null;
      available_all_tournaments: boolean;
      available_all_event_duration: boolean;
    }>;

    if (rows.length === 0) return [];

    const userIds = rows.map((r) => r.user_id).filter((id): id is string => !!id);
    const personIdsFromUnclaimed = rows.map((r) => r.person_id).filter((id): id is string => !!id);

    // 2. Load active qualifications for this event. R6: qualifications can
    //    be either user-keyed or person-keyed — fetch both buckets so the
    //    list page shows the same rows for unclaimed referees.
    const qualsByUser = new Map<string, Array<{ skillId: string; rating: number | null }>>();
    const qualsByPerson = new Map<string, Array<{ skillId: string; rating: number | null }>>();
    if (userIds.length > 0) {
      const { data: qualRows, error: qualError } = await this.supabase.service
        .from('referee_qualifications')
        .select('user_id, role, rating')
        .eq('event_id', eventId)
        .eq('active', true)
        .in('user_id', userIds);
      if (qualError) throw new BadRequestException(qualError.message);
      for (const q of (qualRows ?? []) as Array<{
        user_id: string;
        role: string;
        rating: number | null;
      }>) {
        const list = qualsByUser.get(q.user_id) ?? [];
        list.push({ skillId: q.role, rating: q.rating ?? null });
        qualsByUser.set(q.user_id, list);
      }
    }
    if (personIdsFromUnclaimed.length > 0) {
      const { data: qualRows, error: qualError } = await this.supabase.service
        .from('referee_qualifications')
        .select('person_id, role, rating')
        .eq('event_id', eventId)
        .eq('active', true)
        .in('person_id', personIdsFromUnclaimed);
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
    }

    // 3. Load global_persons for display name + club.
    //    Claimed referees: lookup by claimed_by_user_id IN userIds.
    //    Unclaimed referees (R6): lookup by id IN personIdsFromUnclaimed.
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
    const gpById = new Map<
      string,
      {
        id: string;
        given_name: string;
        family_name: string;
        display_name: string;
        club_id: string | null;
      }
    >();
    if (userIds.length > 0) {
      const { data: gpRows } = await this.supabase.service
        .from('global_persons')
        .select('id, claimed_by_user_id, given_name, family_name, display_name, club_id')
        .in('claimed_by_user_id', userIds);
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
    }
    if (personIdsFromUnclaimed.length > 0) {
      const { data: gpRows } = await this.supabase.service
        .from('global_persons')
        .select('id, given_name, family_name, display_name, club_id')
        .in('id', personIdsFromUnclaimed);
      for (const gp of (gpRows ?? []) as Array<{
        id: string;
        given_name: string;
        family_name: string;
        display_name: string;
        club_id: string | null;
      }>) {
        gpById.set(gp.id, gp);
      }
    }

    // 3b. For any user_id that has no global_persons row, fall back to the
    // event-scoped persons table so the referee still shows a real name in
    // the list (instead of a raw UUID).
    const missingUserIds = userIds.filter((u) => !gpByUser.has(u));
    const personByUser = new Map<
      string,
      { id: string; given_name: string; family_name: string; club_id: string | null }
    >();
    if (missingUserIds.length > 0) {
      const { data: pRows } = await this.supabase.service
        .from('persons')
        .select('id, claimed_by_user_id, given_name, family_name, club_id')
        .eq('event_id', eventId)
        .in('claimed_by_user_id', missingUserIds);
      for (const p of (pRows ?? []) as Array<{
        id: string;
        claimed_by_user_id: string;
        given_name: string;
        family_name: string;
        club_id: string | null;
      }>) {
        personByUser.set(p.claimed_by_user_id, p);
      }
    }

    // 4. Resolve club labels — best-effort: collect unique club_ids and batch-fetch names
    const clubIds = Array.from(
      new Set(
        [
          ...Array.from(gpByUser.values()),
          ...Array.from(gpById.values()),
          ...Array.from(personByUser.values()),
        ]
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

    // 5. Build assignment counts per user per tournament
    const assignmentMap = await this.countAssignmentsByReferee(eventId);

    // 6. Merge into EventRefereeRow[] — handles both user-keyed (claimed)
    //    and person-keyed (R6 unclaimed) rows. The fallback key is
    //    always personId so the frontend has a stable identity even
    //    while user_id is null.
    return rows.map((r) => {
      const unclaimed = !r.user_id;
      const gp = r.user_id
        ? (gpByUser.get(r.user_id) ?? null)
        : r.person_id
          ? (gpById.get(r.person_id) ?? null)
          : null;
      const fallbackPerson =
        !unclaimed && r.user_id && !gp ? (personByUser.get(r.user_id) ?? null) : null;
      const personId = gp?.id ?? fallbackPerson?.id ?? r.person_id ?? null;
      const fallbackLabel = r.user_id ?? r.person_id ?? '';
      const displayName = gp
        ? `${gp.given_name} ${gp.family_name}`.trim() || gp.display_name || fallbackLabel
        : fallbackPerson
          ? `${fallbackPerson.given_name} ${fallbackPerson.family_name}`.trim() || fallbackLabel
          : fallbackLabel;

      const qualifications = r.user_id
        ? (qualsByUser.get(r.user_id) ?? [])
        : r.person_id
          ? (qualsByPerson.get(r.person_id) ?? [])
          : [];

      const userAssignments = r.user_id ? assignmentMap.get(r.user_id) : undefined;

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

      const clubId = gp?.club_id ?? fallbackPerson?.club_id ?? null;
      return {
        userId: r.user_id,
        personId,
        unclaimed,
        displayName,
        clubLabel: clubId ? (clubsById.get(clubId) ?? null) : null,
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
      description: typeof r['description'] === 'string' ? (r['description'] as string) : '',
      createdAt: r['created_at'] as string,
      updatedAt: r['updated_at'] as string,
    };
  }
}
