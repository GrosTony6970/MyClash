/**
 * workshops.service.ts — T-801
 *
 * CRUD for workshops, instructors, sessions.
 *
 * Column names here track the migration schema (the deploy source of
 * truth): `workshops.title/short_description/description_md`,
 * `workshop_sessions.starts_at/ends_at/location_label`,
 * `workshop_instructors.global_person_id/display_name`. List/get
 * responses are hand-mapped to a stable camelCase DTO (there is no
 * global snake→camel transform) so both front-ends consume one shape.
 */

import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { NotificationSchedulerService } from '../../workers/notification-scheduler.worker';
import { NotificationEventsService } from '../notifications/event-handlers/notification-events.service';
import { OrganizationsService } from '../organizations/organizations.service';
import { PrivacyService } from '../persons/privacy.service';
import { SupabaseService } from '../supabase/supabase.service';

export interface CreateWorkshopDto {
  slug: string;
  title: string;
  shortDescription?: string | null;
  descriptionMd?: string | null;
  category?: string | null;
  level?: string | null;
  language?: string | null;
  capacity?: number | null;
  /** Optional default duration; sessions derive end time from it. */
  durationMinutes?: number | null;
  status?: string | null;
  /** Optional identity color (ColorToken string), like tournaments.color. */
  color?: string | null;
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
  title?: string;
  shortDescription?: string | null;
  descriptionMd?: string | null;
  category?: string | null;
  level?: string | null;
  language?: string | null;
  capacity?: number | null;
  durationMinutes?: number | null;
  status?: string | null;
  /** Optional identity color (ColorToken string); send `null` to clear. */
  color?: string | null;
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

// ── DTO (stable camelCase wire contract) ───────────────────────────────────────

interface NamedRef {
  id: string;
  name: string;
}

export interface WorkshopSessionView {
  id: string;
  startsAt: string | null;
  endsAt: string | null;
  locationLabel: string | null;
  venueId: string | null;
  areaId: string | null;
  venue: NamedRef | null;
  area: NamedRef | null;
  /** Effective capacity = workshop capacity (sessions have no own column). */
  capacity: number | null;
  confirmedCount: number;
  status: string | null;
}

export interface WorkshopView {
  id: string;
  slug: string;
  title: string;
  shortDescription: string | null;
  descriptionMd: string | null;
  category: string | null;
  level: string | null;
  language: string | null;
  capacity: number | null;
  durationMinutes: number | null;
  status: string;
  sortOrder: number;
  /** Optional identity color (ColorToken string), like tournaments.color. */
  color: string | null;
  venueId: string | null;
  venue: NamedRef | null;
  /** Event IANA timezone — set on public reads so the FE renders in event time. */
  eventTimezone: string | null;
  instructors: Array<{ globalPersonId: string | null; displayName: string }>;
  sessions: WorkshopSessionView[];
}

// ── Raw row shapes (as returned by Supabase, snake_case) ───────────────────────

interface RawSession {
  id: string;
  starts_at: string | null;
  ends_at: string | null;
  location_label: string | null;
  venue_id: string | null;
  area_id: string | null;
  venues: NamedRef | null;
  venue_areas: NamedRef | null;
  status: string | null;
}

interface RawInstructor {
  global_person_id: string | null;
  display_name: string;
}

interface RawWorkshop {
  id: string;
  slug: string;
  title: string;
  short_description: string | null;
  description_md: string | null;
  category: string | null;
  level: string | null;
  language: string | null;
  capacity: number | null;
  duration_minutes: number | null;
  status: string | null;
  sort_order: number | null;
  color: string | null;
  venue_id: string | null;
  venues: NamedRef | null;
  // PostgREST embeds a to-one relationship as a single object. Migration 0098's
  // UNIQUE(workshop_id) on workshop_sessions flips this embed from array → object,
  // so it can arrive either way — always read it through `toArray`.
  workshop_sessions: RawSession | RawSession[] | null;
  workshop_instructors: RawInstructor[] | null;
}

/** Normalize a PostgREST embed (object | array | null) to an array. */
function toArray<T>(value: T | T[] | null | undefined): T[] {
  if (Array.isArray(value)) return value;
  return value == null ? [] : [value];
}

// Public visibility gate — mirrors TOURNAMENT_PUBLIC_STATUSES.
const PUBLIC_WORKSHOP_STATUSES = ['published', 'running', 'completed'];

const WORKSHOP_SELECT = `
  id, slug, title, short_description, description_md, category, level, language,
  capacity, duration_minutes, status, sort_order, color, venue_id,
  venues ( id, name ),
  workshop_sessions ( id, starts_at, ends_at, location_label, venue_id, area_id, status, venues ( id, name ), venue_areas ( id, name ) ),
  workshop_instructors ( global_person_id, display_name )
`;

@Injectable()
export class WorkshopsService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly notifications: NotificationSchedulerService,
    private readonly notificationEvents: NotificationEventsService,
    private readonly orgs: OrganizationsService,
    private readonly privacy: PrivacyService,
  ) {}

  // ── List workshops for event ──────────────────────────────────────────────────

  async listWorkshops(eventId: string): Promise<WorkshopView[]> {
    const { data, error } = await this.supabase.service
      .from('workshops')
      .select(WORKSHOP_SELECT)
      .eq('event_id', eventId)
      .order('sort_order', { ascending: true })
      .order('title', { ascending: true });

    if (error) throw new BadRequestException(error.message);
    const rows = (data ?? []) as unknown as RawWorkshop[];
    const counts = await this.confirmedCountsForWorkshops(rows);
    return rows.map((row) => this.mapWorkshop(row, counts));
  }

  // ── Public reads (slug-based, status-gated) ─────────────────────────────────────

  /**
   * Public workshop catalog for an event, resolved by event slug. Returns
   * only published/running/completed workshops. Instructors who set the
   * per-person "hide my workshops publicly" flag are dropped from the
   * instructor lists (the workshop itself stays public). No auth.
   */
  async listPublicWorkshops(eventSlug: string): Promise<WorkshopView[]> {
    const event = await this.resolveEventBySlug(eventSlug);
    if (!event) return [];

    const { data, error } = await this.supabase.service
      .from('workshops')
      .select(WORKSHOP_SELECT)
      .eq('event_id', event.id)
      .in('status', PUBLIC_WORKSHOP_STATUSES)
      .order('sort_order', { ascending: true })
      .order('title', { ascending: true });

    if (error) throw new BadRequestException(error.message);
    const rows = (data ?? []) as unknown as RawWorkshop[];
    const counts = await this.confirmedCountsForWorkshops(rows);
    const views = rows.map((row) => ({
      ...this.mapWorkshop(row, counts),
      eventTimezone: event.timezone,
    }));
    return this.applyInstructorPrivacy(event.id, views);
  }

  /** Public single workshop by (event slug, workshop slug), status-gated. */
  async getPublicWorkshopBySlug(eventSlug: string, workshopSlug: string): Promise<WorkshopView> {
    const event = await this.resolveEventBySlug(eventSlug);
    if (!event) throw new NotFoundException(`Workshop "${workshopSlug}" not found`);

    const { data, error } = await this.supabase.service
      .from('workshops')
      .select(WORKSHOP_SELECT)
      .eq('event_id', event.id)
      .eq('slug', workshopSlug)
      .in('status', PUBLIC_WORKSHOP_STATUSES)
      .maybeSingle();

    if (error) throw new BadRequestException(error.message);
    if (!data) throw new NotFoundException(`Workshop "${workshopSlug}" not found`);
    const row = data as unknown as RawWorkshop;
    const counts = await this.confirmedCountsForWorkshops([row]);
    const view = { ...this.mapWorkshop(row, counts), eventTimezone: event.timezone };
    const [withPrivacy] = await this.applyInstructorPrivacy(event.id, [view]);
    return withPrivacy!;
  }

  /** Drop instructors whose person set `hide_workshops_publicly` from public DTOs. */
  private async applyInstructorPrivacy(
    eventId: string,
    views: WorkshopView[],
  ): Promise<WorkshopView[]> {
    const globalIds = views.flatMap((w) =>
      w.instructors.map((i) => i.globalPersonId).filter((id): id is string => Boolean(id)),
    );
    if (globalIds.length === 0) return views;
    const hidden = await this.privacy.hiddenWorkshopGlobalPersonIds(eventId, globalIds);
    if (hidden.size === 0) return views;
    return views.map((w) => ({
      ...w,
      instructors: w.instructors.filter((i) => !(i.globalPersonId && hidden.has(i.globalPersonId))),
    }));
  }

  private async resolveEventBySlug(
    eventSlug: string,
  ): Promise<{ id: string; timezone: string } | null> {
    const { data } = await this.supabase.service
      .from('events')
      .select('id, timezone')
      .eq('slug', eventSlug)
      .limit(1)
      .maybeSingle();
    if (!data) return null;
    const row = data as { id: string; timezone: string | null };
    return { id: row.id, timezone: row.timezone ?? 'Europe/Paris' };
  }

  // ── Get one workshop ──────────────────────────────────────────────────────────

  async getWorkshop(workshopId: string): Promise<WorkshopView> {
    const { data, error } = await this.supabase.service
      .from('workshops')
      .select(WORKSHOP_SELECT)
      .eq('id', workshopId)
      .maybeSingle();

    if (error) throw new BadRequestException(error.message);
    if (!data) throw new NotFoundException(`Workshop ${workshopId} not found`);
    const row = data as unknown as RawWorkshop;
    const counts = await this.confirmedCountsForWorkshops([row]);
    return this.mapWorkshop(row, counts);
  }

  // ── Create workshop ───────────────────────────────────────────────────────────

  async createWorkshop(eventId: string, dto: CreateWorkshopDto, userId: string) {
    await this.assertCanManageEvent(eventId, userId);

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
        title: dto.title.trim(),
        short_description: dto.shortDescription ?? null,
        description_md: dto.descriptionMd ?? null,
        category: dto.category ?? null,
        level: dto.level ?? 'all',
        language: dto.language ?? 'fr',
        capacity: dto.capacity ?? null,
        duration_minutes: dto.durationMinutes ?? null,
        status: dto.status ?? 'draft',
        color: dto.color ?? null,
        venue_id: dto.venueId ?? null,
      })
      .select('*')
      .single();

    if (error) throw new BadRequestException(error.message);
    return data;
  }

  // ── Update workshop ───────────────────────────────────────────────────────────

  async updateWorkshop(workshopId: string, dto: UpdateWorkshopDto, userId: string) {
    const eventId = await this.resolveWorkshopEvent(workshopId);
    await this.assertCanManageEvent(eventId, userId);

    // Repointing the workshop's default venue needs the same cross-org
    // guard the create path enforces.
    if (dto.venueId) {
      await this.assertVenueBelongsToEventsOrg(dto.venueId, eventId);
    }

    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (dto.title !== undefined) updates['title'] = dto.title.trim();
    if (dto.shortDescription !== undefined) updates['short_description'] = dto.shortDescription;
    if (dto.descriptionMd !== undefined) updates['description_md'] = dto.descriptionMd;
    if (dto.category !== undefined) updates['category'] = dto.category;
    if (dto.level !== undefined) updates['level'] = dto.level;
    if (dto.language !== undefined) updates['language'] = dto.language;
    if (dto.capacity !== undefined) updates['capacity'] = dto.capacity;
    if (dto.durationMinutes !== undefined) updates['duration_minutes'] = dto.durationMinutes;
    if (dto.status !== undefined) updates['status'] = dto.status;
    if (dto.color !== undefined) updates['color'] = dto.color;
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

  /**
   * Tag a global person as an instructor on a workshop. `display_name`
   * is NOT NULL in the schema, so it is resolved from global_persons.
   */
  async addInstructor(workshopId: string, globalPersonId: string, userId: string) {
    await this.assertCanManageEvent(await this.resolveWorkshopEvent(workshopId), userId);

    const { data: person } = await this.supabase.service
      .from('global_persons')
      .select('display_name, given_name, family_name')
      .eq('id', globalPersonId)
      .maybeSingle();
    if (!person) throw new BadRequestException(`Global person ${globalPersonId} not found`);
    const p = person as { display_name?: string; given_name?: string; family_name?: string };
    const displayName =
      p.display_name?.trim() ||
      [p.given_name, p.family_name].filter(Boolean).join(' ').trim() ||
      'Instructor';

    const { data, error } = await this.supabase.service
      .from('workshop_instructors')
      .upsert(
        { workshop_id: workshopId, global_person_id: globalPersonId, display_name: displayName },
        { onConflict: 'workshop_id,global_person_id' },
      )
      .select('*')
      .single();

    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async removeInstructor(workshopId: string, globalPersonId: string, userId: string) {
    await this.assertCanManageEvent(await this.resolveWorkshopEvent(workshopId), userId);
    const { error } = await this.supabase.service
      .from('workshop_instructors')
      .delete()
      .eq('workshop_id', workshopId)
      .eq('global_person_id', globalPersonId);
    if (error) throw new BadRequestException(error.message);
  }

  // ── Event instructor roster (event-scoped; mirrors referees, no global flag) ────

  /** Tagged instructors for an event: [{ personId (= global_persons.id), displayName }]. */
  async listEventInstructors(
    eventId: string,
    userId: string,
  ): Promise<Array<{ personId: string; displayName: string }>> {
    await this.assertCanReadEvent(eventId, userId);
    const { data, error } = await this.supabase.service
      .from('event_instructors')
      .select('person_id, global_persons ( display_name, given_name, family_name )')
      .eq('event_id', eventId);
    if (error) throw new BadRequestException(error.message);
    type Gp = { display_name?: string; given_name?: string; family_name?: string };
    return (data ?? []).map((raw) => {
      const r = raw as unknown as { person_id: string; global_persons: Gp | Gp[] | null };
      const gp = Array.isArray(r.global_persons) ? (r.global_persons[0] ?? null) : r.global_persons;
      const displayName =
        gp?.display_name?.trim() ||
        [gp?.given_name, gp?.family_name].filter(Boolean).join(' ').trim() ||
        'Instructor';
      return { personId: r.person_id, displayName };
    });
  }

  /** Tag a person as an instructor for this event (idempotent). */
  async tagEventInstructor(eventId: string, personId: string, userId: string): Promise<void> {
    await this.assertCanManageEvent(eventId, userId);
    const globalPersonId = await this.resolveGlobalPersonId(personId, eventId);
    const { error } = await this.supabase.service
      .from('event_instructors')
      .upsert(
        { event_id: eventId, person_id: globalPersonId },
        { onConflict: 'event_id,person_id', ignoreDuplicates: true },
      );
    if (error) throw new BadRequestException(error.message);
  }

  /** Untag a person as an instructor for this event. */
  async untagEventInstructor(eventId: string, personId: string, userId: string): Promise<void> {
    await this.assertCanManageEvent(eventId, userId);
    const globalPersonId = await this.resolveGlobalPersonId(personId, eventId);
    const { error } = await this.supabase.service
      .from('event_instructors')
      .delete()
      .eq('event_id', eventId)
      .eq('person_id', globalPersonId);
    if (error) throw new BadRequestException(error.message);
  }

  /**
   * Resolve a caller-supplied id to a global_persons.id. Accepts either a
   * global_persons.id directly or an event-scoped persons.id (resolved via
   * persons.global_person_id) — mirrors ensureEventReferee.
   */
  private async resolveGlobalPersonId(personId: string, eventId: string): Promise<string> {
    const { data: gp } = await this.supabase.service
      .from('global_persons')
      .select('id')
      .eq('id', personId)
      .maybeSingle();
    if (gp) return personId;

    const { data: personsRow } = await this.supabase.service
      .from('persons')
      .select('global_person_id')
      .eq('id', personId)
      .eq('event_id', eventId)
      .maybeSingle();
    const linked = (personsRow as { global_person_id: string | null } | null)?.global_person_id;
    if (linked) return linked;
    if (personsRow) {
      throw new BadRequestException(
        `Participant ${personId} has no global profile — link or create one first.`,
      );
    }
    throw new BadRequestException(`Global person ${personId} not found.`);
  }

  // ── Create session ────────────────────────────────────────────────────────────

  async createSession(workshopId: string, dto: CreateSessionDto, userId: string) {
    const eventId = await this.resolveWorkshopEvent(workshopId);
    await this.assertCanManageEvent(eventId, userId);

    if (dto.venueId) {
      await this.assertVenueBelongsToEventsOrg(dto.venueId, eventId);
    }
    if (dto.areaId) {
      await this.assertAreaBelongsToVenue(dto.areaId, dto.venueId ?? null);
    }

    // A workshop has at most one session (UNIQUE(workshop_id), migration
    // 0098) — upsert keeps the scheduling form idempotent: re-scheduling
    // updates the existing block instead of stacking duplicates.
    const { data, error } = await this.supabase.service
      .from('workshop_sessions')
      .upsert(
        {
          workshop_id: workshopId,
          starts_at: dto.startTime,
          ends_at: dto.endTime,
          location_label: dto.location ?? null,
          venue_id: dto.venueId ?? null,
          area_id: dto.areaId ?? null,
          status: dto.status ?? 'scheduled',
        },
        { onConflict: 'workshop_id' },
      )
      .select('*')
      .single();

    if (error) throw new BadRequestException(error.message);
    await this.notifications.scheduleWorkshopSessionStarting((data as { id: string }).id);
    return data;
  }

  // ── Update session ────────────────────────────────────────────────────────────

  async updateSession(sessionId: string, dto: Partial<CreateSessionDto>, userId: string) {
    await this.assertCanManageSession(sessionId, userId);

    const updates: Record<string, unknown> = {};
    if (dto.startTime !== undefined) updates['starts_at'] = dto.startTime;
    if (dto.endTime !== undefined) updates['ends_at'] = dto.endTime;
    if (dto.location !== undefined) updates['location_label'] = dto.location;
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

  // ── Delete session (unschedule) ─────────────────────────────────────────────────

  /** Delete a workshop's session, returning the workshop to the unscheduled drawer. */
  async deleteSession(sessionId: string, userId: string) {
    await this.assertCanManageSession(sessionId, userId);
    const { error } = await this.supabase.service
      .from('workshop_sessions')
      .delete()
      .eq('id', sessionId);
    if (error) throw new BadRequestException(error.message);
  }

  /** Public authz hook for organizer actions routed through other services (e.g. promote). */
  async authorizeSession(sessionId: string, userId: string): Promise<void> {
    await this.assertCanManageSession(sessionId, userId);
  }

  // ── Session roster (organizer-only) ────────────────────────────────────────────

  async getSessionRoster(sessionId: string, userId: string) {
    await this.assertCanManageSession(sessionId, userId);

    const { data, error } = await this.supabase.service
      .from('workshop_enrollments')
      .select(
        `
        id, status, position, enrolled_at, user_id, global_person_id,
        global_persons ( id, given_name, family_name )
      `,
      )
      .eq('workshop_session_id', sessionId)
      .order('position', { ascending: true, nullsFirst: false })
      .order('enrolled_at', { ascending: true });

    if (error) throw new BadRequestException(error.message);
    type Gp = { id: string; given_name: string; family_name: string };
    return (data ?? []).map((raw) => {
      const e = raw as unknown as {
        id: string;
        status: string;
        position: number | null;
        enrolled_at: string;
        user_id: string | null;
        global_person_id: string | null;
        global_persons: Gp | Gp[] | null;
      };
      // Supabase types a joined FK as an array; a to-one link is a single row.
      const gp = Array.isArray(e.global_persons) ? (e.global_persons[0] ?? null) : e.global_persons;
      return {
        id: e.id,
        status: e.status,
        waitlistPosition: e.position,
        enrolledAt: e.enrolled_at,
        global_person_id: e.global_person_id,
        persons: gp
          ? { id: gp.id, givenName: gp.given_name, familyName: gp.family_name, clubs: null }
          : null,
      };
    });
  }

  // ── DTO mapping ────────────────────────────────────────────────────────────────

  private mapWorkshop(row: RawWorkshop, counts: Map<string, number>): WorkshopView {
    const capacity = row.capacity ?? null;
    return {
      id: row.id,
      slug: row.slug,
      title: row.title,
      shortDescription: row.short_description,
      descriptionMd: row.description_md,
      category: row.category,
      level: row.level,
      language: row.language,
      capacity,
      durationMinutes: row.duration_minutes,
      status: row.status ?? 'draft',
      sortOrder: row.sort_order ?? 0,
      color: row.color ?? null,
      venueId: row.venue_id,
      venue: row.venues ?? null,
      eventTimezone: null,
      instructors: (row.workshop_instructors ?? []).map((i) => ({
        globalPersonId: i.global_person_id,
        displayName: i.display_name,
      })),
      sessions: toArray(row.workshop_sessions).map((s) => ({
        id: s.id,
        startsAt: s.starts_at,
        endsAt: s.ends_at,
        locationLabel: s.location_label,
        venueId: s.venue_id,
        areaId: s.area_id,
        venue: s.venues ?? null,
        area: s.venue_areas ?? null,
        capacity,
        confirmedCount: counts.get(s.id) ?? 0,
        status: s.status,
      })),
    };
  }

  /** One batched count query for all sessions across the given workshops. */
  private async confirmedCountsForWorkshops(rows: RawWorkshop[]): Promise<Map<string, number>> {
    const sessionIds = rows.flatMap((r) => toArray(r.workshop_sessions).map((s) => s.id));
    const counts = new Map<string, number>();
    if (sessionIds.length === 0) return counts;
    try {
      const { data } = await this.supabase.service
        .from('workshop_enrollments')
        .select('workshop_session_id')
        .in('workshop_session_id', sessionIds)
        .eq('status', 'confirmed');
      for (const raw of data ?? []) {
        const sid = (raw as { workshop_session_id: string }).workshop_session_id;
        counts.set(sid, (counts.get(sid) ?? 0) + 1);
      }
    } catch {
      /* counts best-effort; default 0 */
    }
    return counts;
  }

  // ── Workshop-only break blocks (separate store from event programme) ────────────

  async listWorkshopBreaks(eventId: string) {
    const { data, error } = await this.supabase.service
      .from('workshop_breaks')
      .select('id, event_id, day_index, start_time, end_time, label, color')
      .eq('event_id', eventId)
      .order('day_index', { ascending: true })
      .order('start_time', { ascending: true });
    if (error) throw new BadRequestException(error.message);
    return (data ?? []).map((raw) => {
      const b = raw as {
        id: string;
        day_index: number;
        start_time: string;
        end_time: string;
        label: string | null;
        color: string | null;
      };
      return {
        id: b.id,
        dayIndex: b.day_index,
        startTime: b.start_time,
        endTime: b.end_time,
        label: b.label,
        color: b.color ?? null,
      };
    });
  }

  async createWorkshopBreak(
    eventId: string,
    dto: {
      dayIndex?: number;
      startTime: string;
      endTime: string;
      label?: string | null;
      color?: string | null;
    },
    userId: string,
  ) {
    await this.assertCanManageEvent(eventId, userId);
    if (dto.endTime <= dto.startTime) {
      throw new BadRequestException('Break end time must be after the start time');
    }
    const { data, error } = await this.supabase.service
      .from('workshop_breaks')
      .insert({
        event_id: eventId,
        day_index: dto.dayIndex ?? 0,
        start_time: dto.startTime,
        end_time: dto.endTime,
        label: dto.label ?? null,
        color: dto.color ?? null,
      })
      .select('*')
      .single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async updateWorkshopBreak(
    breakId: string,
    dto: {
      dayIndex?: number;
      startTime?: string;
      endTime?: string;
      label?: string | null;
      color?: string | null;
    },
    userId: string,
  ) {
    await this.assertCanManageBreak(breakId, userId);
    const updates: Record<string, unknown> = {};
    if (dto.dayIndex !== undefined) updates['day_index'] = dto.dayIndex;
    if (dto.startTime !== undefined) updates['start_time'] = dto.startTime;
    if (dto.endTime !== undefined) updates['end_time'] = dto.endTime;
    if (dto.label !== undefined) updates['label'] = dto.label;
    if (dto.color !== undefined) updates['color'] = dto.color;
    const { data, error } = await this.supabase.service
      .from('workshop_breaks')
      .update(updates)
      .eq('id', breakId)
      .select('*')
      .single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async deleteWorkshopBreak(breakId: string, userId: string) {
    await this.assertCanManageBreak(breakId, userId);
    const { error } = await this.supabase.service
      .from('workshop_breaks')
      .delete()
      .eq('id', breakId);
    if (error) throw new BadRequestException(error.message);
  }

  private async assertCanManageBreak(breakId: string, userId: string): Promise<void> {
    const { data } = await this.supabase.service
      .from('workshop_breaks')
      .select('event_id')
      .eq('id', breakId)
      .maybeSingle();
    if (!data) throw new NotFoundException(`Break ${breakId} not found`);
    await this.assertCanManageEvent(String((data as { event_id: string }).event_id), userId);
  }

  // ── Authorization helpers ───────────────────────────────────────────────────────

  private async resolveWorkshopEvent(workshopId: string): Promise<string> {
    const { data } = await this.supabase.service
      .from('workshops')
      .select('event_id')
      .eq('id', workshopId)
      .maybeSingle();
    if (!data) throw new NotFoundException(`Workshop ${workshopId} not found`);
    return String((data as { event_id: string }).event_id);
  }

  private async assertCanManageEvent(eventId: string, userId: string): Promise<void> {
    await this.assertEventRole(eventId, userId, 'workshop_lead');
  }

  private async assertCanReadEvent(eventId: string, userId: string): Promise<void> {
    await this.assertEventRole(eventId, userId, 'read_only');
  }

  private async assertEventRole(
    eventId: string,
    userId: string,
    role: Parameters<OrganizationsService['assertOrgRole']>[2],
  ): Promise<void> {
    const { data: event } = await this.supabase.service
      .from('events')
      .select('organization_id')
      .eq('id', eventId)
      .maybeSingle();
    if (!event) throw new NotFoundException(`Event ${eventId} not found`);
    await this.orgs.assertOrgRole(
      String((event as { organization_id: string }).organization_id),
      userId,
      role,
    );
  }

  private async assertCanManageSession(sessionId: string, userId: string): Promise<void> {
    const { data: session } = await this.supabase.service
      .from('workshop_sessions')
      .select('workshop_id')
      .eq('id', sessionId)
      .maybeSingle();
    if (!session) throw new NotFoundException(`Session ${sessionId} not found`);
    const eventId = await this.resolveWorkshopEvent(
      String((session as { workshop_id: string }).workshop_id),
    );
    await this.assertCanManageEvent(eventId, userId);
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
