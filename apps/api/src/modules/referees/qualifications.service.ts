/**
 * qualifications.service.ts — T-901 / T-906
 *
 * CRUD for referee_qualifications (per-event role + rating).
 * Skills catalog: system skills + per-event custom skills.
 *
 * AC:
 *   - 0..3 active qualifications per user per event (one per role)
 *   - Rating 1..5 or null
 *   - Soft delete via active=false preserves history
 *   - System skills cannot be edited or deleted
 *   - Custom skills cannot be deleted if active qualifications reference them
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
    role: RefereeRole,
    rating: number | null,
  ): Promise<RefereeQualification> {
    if (!REFEREE_ROLES.includes(role)) {
      throw new BadRequestException(`Invalid role: ${role}`);
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

  // ── Private ───────────────────────────────────────────────────────────────────

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
