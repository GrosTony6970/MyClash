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
import { NotificationSchedulerService } from '../../workers/notification-scheduler.worker';
import { NotificationEventsService } from '../notifications/event-handlers/notification-events.service';
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
  /**
   * Default venue for this workshop. Sessions of this workshop
   * pre-fill their own venue_id from this column at create time;
   * the operator can still override per session. Must belong to the
   * same org as the workshop's event — the service rejects cross-org
   * references.
   */
  venueId?: string | null;
}

export interface UpdateWorkshopDto {
  name?: string;
  description?: string;
  category?: string;
  level?: string;
  language?: string;
  capacity?: number;
  locationLabel?: string;
  /**
   * Repoint the workshop's default venue. Send `null` to clear it
   * (subsequent sessions will not pre-fill a venue).
   */
  venueId?: string | null;
}

export interface CreateSessionDto {
  startTime: string; // ISO
  endTime: string; // ISO
  location?: string;
  capacity?: number; // override workshop capacity for this session
  status?: string;
  /**
   * Org-level venue this session happens in. The venue must belong
   * to the workshop's event's org — the service rejects cross-org
   * references.
   */
  venueId?: string | null;
  /**
   * Optional area inside the venue. Required only when the operator
   * has split the venue into 2+ areas; otherwise the session links
   * to the venue directly.
   */
  areaId?: string | null;
}

@Injectable()
export class WorkshopsService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly notifications: NotificationSchedulerService,
    private readonly notificationEvents: NotificationEventsService,
  ) {}

  // ── List workshops for event ──────────────────────────────────────────────────

  async listWorkshops(eventId: string) {
    // Project the joined venue + area so the workshop admin page can
    // render `Venue · Area` on each session row without a second
    // round-trip. Same idea as lices.list joining venues(id, name).
    // Workshop-level venue (id, name) is projected via `venues!workshops_venue_id_fkey`
    // — Supabase picks the right FK by alias when more than one venue
    // join exists in the projection.
    const { data, error } = await this.supabase.service
      .from('workshops')
      .select(
        `
        *,
        venues ( id, name ),
        workshop_sessions ( id, start_time, end_time, location, capacity, venue_id, area_id, venues(id, name), venue_areas(id, name) ),
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
        venues ( id, name ),
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

    // Cross-org guard: a workshop's default venue must belong to the
    // same org as its event. Mirrors the session-level guard so the
    // operator can't pick a sibling-org venue from the picker.
    if (dto.venueId) {
      await this.assertVenueBelongsToEventsOrg(dto.venueId, eventId);
    }

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
        venue_id: dto.venueId ?? null,
      })
      .select('*')
      .single();

    if (error) throw new BadRequestException(error.message);
    await this.notifications.scheduleWorkshopSessionStarting((data as { id: string }).id);
    return data;
  }

  // ── Update workshop ───────────────────────────────────────────────────────────

  async updateWorkshop(workshopId: string, dto: UpdateWorkshopDto) {
    // Repointing the workshop's default venue needs the same cross-org
    // guard the create path enforces — look up the workshop's event_id
    // first, then check the new venue's org matches.
    if (dto.venueId) {
      const { data: workshopRow } = await this.supabase.service
        .from('workshops')
        .select('event_id')
        .eq('id', workshopId)
        .maybeSingle();
      if (!workshopRow) throw new NotFoundException(`Workshop ${workshopId} not found`);
      await this.assertVenueBelongsToEventsOrg(
        dto.venueId,
        String((workshopRow as Record<string, unknown>)['event_id']),
      );
    }

    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (dto.name !== undefined) updates['name'] = dto.name.trim();
    if (dto.description !== undefined) updates['description'] = dto.description;
    if (dto.category !== undefined) updates['category'] = dto.category;
    if (dto.level !== undefined) updates['level'] = dto.level;
    if (dto.language !== undefined) updates['language'] = dto.language;
    if (dto.capacity !== undefined) updates['capacity'] = dto.capacity;
    if (dto.locationLabel !== undefined) updates['location_label'] = dto.locationLabel;
    if (dto.venueId !== undefined) updates['venue_id'] = dto.venueId;

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
    await this.notifications.scheduleWorkshopSessionStarting((data as { id: string }).id);
    return data;
  }

  // ── Create session ────────────────────────────────────────────────────────────

  async createSession(workshopId: string, dto: CreateSessionDto) {
    // Get workshop capacity + event_id as default + scope guard.
    const { data: workshop } = await this.supabase.service
      .from('workshops')
      .select('capacity, event_id')
      .eq('id', workshopId)
      .maybeSingle();

    const capacity = dto.capacity ?? (workshop as { capacity: number } | null)?.capacity ?? 20;

    if (dto.venueId) {
      await this.assertVenueBelongsToEventsOrg(
        dto.venueId,
        String((workshop as { event_id?: string } | null)?.event_id ?? ''),
      );
    }
    if (dto.areaId) {
      await this.assertAreaBelongsToVenue(dto.areaId, dto.venueId ?? null);
    }

    const { data, error } = await this.supabase.service
      .from('workshop_sessions')
      .insert({
        workshop_id: workshopId,
        start_time: dto.startTime,
        end_time: dto.endTime,
        location: dto.location ?? null,
        capacity,
        venue_id: dto.venueId ?? null,
        area_id: dto.areaId ?? null,
      })
      .select('*')
      .single();

    if (error) throw new BadRequestException(error.message);
    await this.notifications.scheduleWorkshopSessionStarting((data as { id: string }).id);
    return data;
  }

  // ── Update session ────────────────────────────────────────────────────────────

  async updateSession(sessionId: string, dto: Partial<CreateSessionDto>) {
    const updates: Record<string, unknown> = {};
    if (dto.startTime !== undefined) updates['start_time'] = dto.startTime;
    if (dto.endTime !== undefined) updates['end_time'] = dto.endTime;
    if (dto.location !== undefined) updates['location'] = dto.location;
    if (dto.capacity !== undefined) updates['capacity'] = dto.capacity;
    if (dto.status !== undefined) updates['status'] = dto.status;
    if (dto.venueId !== undefined) updates['venue_id'] = dto.venueId;
    if (dto.areaId !== undefined) updates['area_id'] = dto.areaId;

    const { data, error } = await this.supabase.service
      .from('workshop_sessions')
      .update(updates)
      .eq('id', sessionId)
      .select('*')
      .single();

    if (error) throw new BadRequestException(error.message);
    await this.notifications.scheduleWorkshopSessionStarting(sessionId);
    if (dto.status === 'cancelled') {
      await this.notificationEvents.workshopCancelled(sessionId);
    }
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

  // ── Cross-org guards ─────────────────────────────────────────────────────────

  private async assertVenueBelongsToEventsOrg(venueId: string, eventId: string): Promise<void> {
    const { data: venue } = await this.supabase.service
      .from('venues')
      .select('organization_id')
      .eq('id', venueId)
      .maybeSingle();
    if (!venue) throw new BadRequestException(`Venue ${venueId} not found`);
    const { data: event } = await this.supabase.service
      .from('events')
      .select('organization_id')
      .eq('id', eventId)
      .maybeSingle();
    if (!event) throw new BadRequestException(`Event ${eventId} not found`);
    if (
      String((venue as Record<string, unknown>)['organization_id']) !==
      String((event as Record<string, unknown>)['organization_id'])
    ) {
      throw new BadRequestException(
        'Venue belongs to a different organization than the workshop event',
      );
    }
  }

  private async assertAreaBelongsToVenue(areaId: string, venueId: string | null): Promise<void> {
    const { data: area } = await this.supabase.service
      .from('venue_areas')
      .select('venue_id')
      .eq('id', areaId)
      .maybeSingle();
    if (!area) throw new BadRequestException(`Area ${areaId} not found`);
    if (venueId && String((area as Record<string, unknown>)['venue_id']) !== venueId) {
      throw new BadRequestException('Area does not belong to the selected venue');
    }
  }
}
