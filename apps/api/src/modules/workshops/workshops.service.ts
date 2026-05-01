/**
 * workshops.service.ts — T-801
 *
 * CRUD for workshops, instructors, sessions.
 * Capacity validated on enrollment (T-802).
 */

import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';

export interface CreateWorkshopDto {
  slug: string;
  name: string;
  description?: string;
  category?: string;
  level?: string;
  language?: string;
  capacity: number;
  locationLabel?: string;
}

export interface UpdateWorkshopDto {
  name?: string;
  description?: string;
  category?: string;
  level?: string;
  language?: string;
  capacity?: number;
  locationLabel?: string;
}

export interface CreateSessionDto {
  startTime: string; // ISO
  endTime: string; // ISO
  location?: string;
  capacity?: number; // override workshop capacity for this session
}

@Injectable()
export class WorkshopsService {
  constructor(private readonly supabase: SupabaseService) {}

  // ── List workshops for event ──────────────────────────────────────────────────

  async listWorkshops(eventId: string) {
    const { data, error } = await this.supabase.service
      .from('workshops')
      .select(
        `
        *,
        workshop_sessions ( id, start_time, end_time, location, capacity ),
        workshop_instructors ( persons ( id, given_name, family_name ) )
      `,
      )
      .eq('event_id', eventId)
      .order('name', { ascending: true });

    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  // ── Get one workshop ──────────────────────────────────────────────────────────

  async getWorkshop(workshopId: string) {
    const { data, error } = await this.supabase.service
      .from('workshops')
      .select(
        `
        *,
        workshop_sessions ( *, workshop_enrollments ( id, person_id, status, waitlist_position ) ),
        workshop_instructors ( persons ( id, given_name, family_name, clubs ( name ) ) )
      `,
      )
      .eq('id', workshopId)
      .maybeSingle();

    if (error) throw new BadRequestException(error.message);
    if (!data) throw new NotFoundException(`Workshop ${workshopId} not found`);
    return data;
  }

  // ── Create workshop ───────────────────────────────────────────────────────────

  async createWorkshop(eventId: string, dto: CreateWorkshopDto) {
    // Check slug uniqueness within event
    const { data: existing } = await this.supabase.service
      .from('workshops')
      .select('id')
      .eq('event_id', eventId)
      .eq('slug', dto.slug)
      .maybeSingle();

    if (existing) throw new ConflictException(`Workshop slug "${dto.slug}" already exists`);

    const { data, error } = await this.supabase.service
      .from('workshops')
      .insert({
        event_id: eventId,
        slug: dto.slug,
        name: dto.name.trim(),
        description: dto.description ?? null,
        category: dto.category ?? null,
        level: dto.level ?? null,
        language: dto.language ?? 'fr',
        capacity: dto.capacity,
        location_label: dto.locationLabel ?? null,
      })
      .select('*')
      .single();

    if (error) throw new BadRequestException(error.message);
    return data;
  }

  // ── Update workshop ───────────────────────────────────────────────────────────

  async updateWorkshop(workshopId: string, dto: UpdateWorkshopDto) {
    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (dto.name !== undefined) updates['name'] = dto.name.trim();
    if (dto.description !== undefined) updates['description'] = dto.description;
    if (dto.category !== undefined) updates['category'] = dto.category;
    if (dto.level !== undefined) updates['level'] = dto.level;
    if (dto.language !== undefined) updates['language'] = dto.language;
    if (dto.capacity !== undefined) updates['capacity'] = dto.capacity;
    if (dto.locationLabel !== undefined) updates['location_label'] = dto.locationLabel;

    const { data, error } = await this.supabase.service
      .from('workshops')
      .update(updates)
      .eq('id', workshopId)
      .select('*')
      .single();

    if (error) throw new BadRequestException(error.message);
    return data;
  }

  // ── Add instructor ────────────────────────────────────────────────────────────

  async addInstructor(workshopId: string, personId: string) {
    const { data, error } = await this.supabase.service
      .from('workshop_instructors')
      .upsert({ workshop_id: workshopId, person_id: personId })
      .select('*')
      .single();

    if (error) throw new BadRequestException(error.message);
    return data;
  }

  // ── Create session ────────────────────────────────────────────────────────────

  async createSession(workshopId: string, dto: CreateSessionDto) {
    // Get workshop capacity as default
    const { data: workshop } = await this.supabase.service
      .from('workshops')
      .select('capacity')
      .eq('id', workshopId)
      .maybeSingle();

    const capacity = dto.capacity ?? (workshop as { capacity: number } | null)?.capacity ?? 20;

    const { data, error } = await this.supabase.service
      .from('workshop_sessions')
      .insert({
        workshop_id: workshopId,
        start_time: dto.startTime,
        end_time: dto.endTime,
        location: dto.location ?? null,
        capacity,
      })
      .select('*')
      .single();

    if (error) throw new BadRequestException(error.message);
    return data;
  }

  // ── Update session ────────────────────────────────────────────────────────────

  async updateSession(sessionId: string, dto: Partial<CreateSessionDto>) {
    const updates: Record<string, unknown> = {};
    if (dto.startTime !== undefined) updates['start_time'] = dto.startTime;
    if (dto.endTime !== undefined) updates['end_time'] = dto.endTime;
    if (dto.location !== undefined) updates['location'] = dto.location;
    if (dto.capacity !== undefined) updates['capacity'] = dto.capacity;

    const { data, error } = await this.supabase.service
      .from('workshop_sessions')
      .update(updates)
      .eq('id', sessionId)
      .select('*')
      .single();

    if (error) throw new BadRequestException(error.message);
    return data;
  }

  // ── Session roster ────────────────────────────────────────────────────────────

  async getSessionRoster(sessionId: string) {
    const { data, error } = await this.supabase.service
      .from('workshop_enrollments')
      .select(
        `
        id, status, waitlist_position, enrolled_at,
        persons ( id, given_name, family_name, clubs ( name ) )
      `,
      )
      .eq('session_id', sessionId)
      .order('waitlist_position', { ascending: true, nullsFirst: false })
      .order('enrolled_at', { ascending: true });

    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }
}
