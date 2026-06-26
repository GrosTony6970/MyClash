import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { OrganizationsService } from '../organizations/organizations.service';
import type {
  CreateVenueAreaDto,
  CreateVenueDto,
  CreateVenueLiceDto,
  UpdateVenueAreaDto,
  UpdateVenueDto,
} from './dto/venues.dto';

type Row = Record<string, unknown>;

type PhaseVenue = { id: string; name: string } | null;
type TournamentPhaseVenues = { pool: PhaseVenue; bracket: PhaseVenue };

/**
 * Venues — org-level catalogue of physical locations reusable
 * across many events. CRUD is org-admin gated. Deletion refuses
 * while any lice or workshop_session still references the venue;
 * the operator must detach those first.
 */
@Injectable()
export class VenuesService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly orgs: OrganizationsService,
  ) {}

  // ── Venues ──────────────────────────────────────────────────────────────────

  async listForOrg(organizationId: string) {
    const { data, error } = await this.supabase.service
      .from('venues')
      .select('*, venue_areas(id, name, sort_order), venue_lices(id, name, sort_order)')
      .eq('organization_id', organizationId)
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true });
    if (error) throw new BadRequestException(error.message);
    const venues = (data ?? []) as Array<Row>;
    if (venues.length === 0) return venues;

    // Which events each venue is used by — derived from the event's lices
    // (venue_id) and its workshop sessions (venue_id). Attached as `events`
    // so the venues catalogue can show where each venue is in play.
    const venueIds = venues.map((v) => String(v['id']));
    const eventIdsByVenue = new Map<string, Set<string>>();
    const link = (venueId: string | null, eventId: string | null) => {
      if (!venueId || !eventId) return;
      const set = eventIdsByVenue.get(venueId) ?? new Set<string>();
      set.add(eventId);
      eventIdsByVenue.set(venueId, set);
    };

    const { data: liceRows } = await this.supabase.service
      .from('lices')
      .select('venue_id, event_id')
      .in('venue_id', venueIds);
    for (const r of (liceRows ?? []) as Array<{
      venue_id: string | null;
      event_id: string | null;
    }>) {
      link(r.venue_id, r.event_id);
    }

    const { data: sessionRows } = await this.supabase.service
      .from('workshop_sessions')
      .select('venue_id, workshops!inner(event_id)')
      .in('venue_id', venueIds);
    for (const r of (sessionRows ?? []) as Array<{
      venue_id: string | null;
      workshops: { event_id: string | null } | Array<{ event_id: string | null }> | null;
    }>) {
      const w = Array.isArray(r.workshops) ? r.workshops[0] : r.workshops;
      link(r.venue_id, w?.event_id ?? null);
    }

    const { data: linkRows } = await this.supabase.service
      .from('event_venues')
      .select('venue_id, event_id')
      .in('venue_id', venueIds);
    for (const r of (linkRows ?? []) as Array<{
      venue_id: string | null;
      event_id: string | null;
    }>) {
      link(r.venue_id, r.event_id);
    }

    const allEventIds = [...new Set([...eventIdsByVenue.values()].flatMap((s) => [...s]))];
    const eventById = new Map<string, { id: string; name: string; slug: string }>();
    if (allEventIds.length > 0) {
      const { data: eventRows } = await this.supabase.service
        .from('events')
        .select('id, name, slug')
        .in('id', allEventIds);
      for (const e of (eventRows ?? []) as Array<{ id: string; name: string; slug: string }>) {
        eventById.set(e.id, e);
      }
    }

    return venues.map((v) => ({
      ...v,
      events: [...(eventIdsByVenue.get(String(v['id'])) ?? [])]
        .map((id) => eventById.get(id))
        .filter((e): e is { id: string; name: string; slug: string } => Boolean(e))
        .sort((a, b) => a.name.localeCompare(b.name)),
    }));
  }

  async get(venueId: string) {
    const { data, error } = await this.supabase.service
      .from('venues')
      .select('*, venue_areas(id, name, sort_order), venue_lices(id, name, sort_order)')
      .eq('id', venueId)
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!data) throw new NotFoundException(`Venue ${venueId} not found`);
    return data;
  }

  async create(organizationId: string, dto: CreateVenueDto, userId: string) {
    await this.orgs.assertOrgRole(organizationId, userId, 'admin');
    const { data, error } = await this.supabase.service
      .from('venues')
      .insert({
        organization_id: organizationId,
        name: dto.name.trim(),
        address: dto.address?.trim() ?? null,
        hosts_tournament: dto.hostsTournament ?? true,
        hosts_workshop: dto.hostsWorkshop ?? true,
        sort_order: dto.sortOrder ?? 0,
      })
      .select('*')
      .single();
    if (error) {
      if (error.message.includes('duplicate'))
        throw new ConflictException(`Venue name "${dto.name}" already exists in this organization`);
      throw new BadRequestException(error.message);
    }
    return data;
  }

  async update(venueId: string, dto: UpdateVenueDto, userId: string) {
    const orgId = await this.assertCanManageVenue(venueId, userId);
    const updates: Row = { updated_at: new Date().toISOString() };
    if (dto.name !== undefined) updates['name'] = dto.name.trim();
    if (dto.address !== undefined) updates['address'] = dto.address?.trim() ?? null;
    if (dto.hostsTournament !== undefined) updates['hosts_tournament'] = dto.hostsTournament;
    if (dto.hostsWorkshop !== undefined) updates['hosts_workshop'] = dto.hostsWorkshop;
    if (dto.sortOrder !== undefined) updates['sort_order'] = dto.sortOrder;

    const { data, error } = await this.supabase.service
      .from('venues')
      .update(updates)
      .eq('id', venueId)
      .select('*')
      .single();
    if (error) {
      if (error.message.includes('duplicate'))
        throw new ConflictException(`Venue name already exists in this organization`);
      throw new BadRequestException(error.message);
    }
    // organizationId from the assert step is the canonical owner; not
    // returned but available for audit consumers.
    void orgId;
    return data;
  }

  async delete(venueId: string, userId: string): Promise<void> {
    await this.assertCanManageVenue(venueId, userId);

    // Refuse if anything still points at this venue. Operators must
    // detach lices / workshop sessions first; mass-delete would
    // otherwise silently orphan whole tournament setups.
    const inUse = await this.isVenueInUse(venueId);
    if (inUse) {
      throw new ConflictException(
        `Venue is still referenced by ${inUse.detail}. Detach those first or delete them, then retry.`,
      );
    }

    const { error } = await this.supabase.service.from('venues').delete().eq('id', venueId);
    if (error) throw new BadRequestException(error.message);
  }

  // ── Venue areas ─────────────────────────────────────────────────────────────

  async createArea(venueId: string, dto: CreateVenueAreaDto, userId: string) {
    await this.assertCanManageVenue(venueId, userId);
    const { data, error } = await this.supabase.service
      .from('venue_areas')
      .insert({
        venue_id: venueId,
        name: dto.name.trim(),
        sort_order: dto.sortOrder ?? 0,
      })
      .select('*')
      .single();
    if (error) {
      if (error.message.includes('duplicate'))
        throw new ConflictException(`Area name "${dto.name}" already exists in this venue`);
      throw new BadRequestException(error.message);
    }
    return data;
  }

  async updateArea(areaId: string, dto: UpdateVenueAreaDto, userId: string) {
    const venueId = await this.assertCanManageArea(areaId, userId);
    const updates: Row = {};
    if (dto.name !== undefined) updates['name'] = dto.name.trim();
    if (dto.sortOrder !== undefined) updates['sort_order'] = dto.sortOrder;

    const { data, error } = await this.supabase.service
      .from('venue_areas')
      .update(updates)
      .eq('id', areaId)
      .select('*')
      .single();
    if (error) {
      if (error.message.includes('duplicate'))
        throw new ConflictException(`Area name already exists in this venue`);
      throw new BadRequestException(error.message);
    }
    void venueId;
    return data;
  }

  async deleteArea(areaId: string, userId: string): Promise<void> {
    await this.assertCanManageArea(areaId, userId);
    const { error } = await this.supabase.service.from('venue_areas').delete().eq('id', areaId);
    if (error) throw new BadRequestException(error.message);
  }

  // ── Venue lices ─────────────────────────────────────────────────────────────
  // Reusable per-venue lices (pistes) for tournament-capable venues — parallel
  // to venue areas. The event wizard pre-fills an event's lices from these.

  async createLice(venueId: string, dto: CreateVenueLiceDto, userId: string) {
    await this.assertCanManageVenue(venueId, userId);
    const { data, error } = await this.supabase.service
      .from('venue_lices')
      .insert({
        venue_id: venueId,
        name: dto.name.trim(),
        sort_order: dto.sortOrder ?? 0,
      })
      .select('*')
      .single();
    if (error) {
      if (error.message.includes('duplicate'))
        throw new ConflictException(`Lice name "${dto.name}" already exists in this venue`);
      throw new BadRequestException(error.message);
    }
    return data;
  }

  async deleteLice(liceId: string, userId: string): Promise<void> {
    await this.assertCanManageLice(liceId, userId);
    const { error } = await this.supabase.service.from('venue_lices').delete().eq('id', liceId);
    if (error) throw new BadRequestException(error.message);
  }

  // ── Event-scoped derived listing ────────────────────────────────────────────

  /**
   * Distinct venues this event references via its lices or its
   * workshop sessions. Powers the event-scoped Venue tab. Public —
   * no auth required because the underlying primitives (lices,
   * workshop_sessions) already have public list endpoints.
   */
  async listForEvent(eventId: string) {
    // Lices for this event → venue ids (non-null).
    const { data: liceRows, error: liceErr } = await this.supabase.service
      .from('lices')
      .select('venue_id')
      .eq('event_id', eventId)
      .not('venue_id', 'is', null);
    if (liceErr) throw new BadRequestException(liceErr.message);

    // Workshop sessions for this event → venue ids. PostgREST can
    // span workshops to filter on event_id via an inner embed.
    const { data: sessionRows, error: sessionErr } = await this.supabase.service
      .from('workshop_sessions')
      .select('venue_id, workshops!inner(event_id)')
      .eq('workshops.event_id', eventId)
      .not('venue_id', 'is', null);
    if (sessionErr) throw new BadRequestException(sessionErr.message);

    // Explicit event↔venue links (may have no lices/sessions yet).
    const { data: linkRows, error: linkErr } = await this.supabase.service
      .from('event_venues')
      .select('venue_id')
      .eq('event_id', eventId);
    if (linkErr) throw new BadRequestException(linkErr.message);

    const ids = new Set<string>();
    for (const r of (liceRows ?? []) as Array<{ venue_id: string | null }>) {
      if (r.venue_id) ids.add(r.venue_id);
    }
    for (const r of (sessionRows ?? []) as Array<{ venue_id: string | null }>) {
      if (r.venue_id) ids.add(r.venue_id);
    }
    for (const r of (linkRows ?? []) as Array<{ venue_id: string | null }>) {
      if (r.venue_id) ids.add(r.venue_id);
    }
    if (ids.size === 0) return [];

    const { data, error } = await this.supabase.service
      .from('venues')
      .select('*, venue_areas(id, name, sort_order), venue_lices(id, name, sort_order)')
      .in('id', [...ids])
      .order('name', { ascending: true });
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  /**
   * Public slug variant of listForEvent. Resolves event_slug → event_id
   * then delegates. Used by the public event page's Venues section.
   */
  async listForEventSlug(eventSlug: string) {
    const { data: event, error } = await this.supabase.service
      .from('events')
      .select('id')
      .eq('slug', eventSlug)
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!event) throw new NotFoundException(`Event ${eventSlug} not found`);
    return this.listForEvent(String((event as Row)['id']));
  }

  // ── Event ↔ venue links (editor reconcile) ──────────────────────────────────

  /**
   * Reconcile the set of venues an event spreads on to exactly `venueIds`
   * (org-admin). Adding a tournament-capable venue seeds the event's lices from
   * the venue's lice catalogue; removing a venue is SAFE — blocked when its
   * lices already have matches or the venue has workshop sessions for this event
   * (those venues stay linked and are returned in `blocked`).
   */
  async setEventVenues(
    eventId: string,
    venueIds: string[],
    userId: string,
  ): Promise<{ blocked: Array<{ venueId: string; reason: string }> }> {
    const { data: event, error: evErr } = await this.supabase.service
      .from('events')
      .select('id, organization_id')
      .eq('id', eventId)
      .maybeSingle();
    if (evErr) throw new BadRequestException(evErr.message);
    if (!event) throw new NotFoundException(`Event ${eventId} not found`);
    const orgId = String((event as Row)['organization_id']);
    await this.orgs.assertOrgRole(orgId, userId, 'admin');

    // Only venues in this org are valid targets.
    const { data: orgVenues } = await this.supabase.service
      .from('venues')
      .select('id, hosts_tournament')
      .eq('organization_id', orgId);
    const orgVenueById = new Map(
      ((orgVenues ?? []) as Array<{ id: string; hosts_tournament: boolean }>).map((v) => [
        String(v.id),
        v,
      ]),
    );
    const requested = [...new Set(venueIds.filter((id) => orgVenueById.has(id)))];
    const requestedSet = new Set(requested);

    // Current effective venues = explicit links ∪ lice venues ∪ session venues.
    const current = new Set<string>();
    const collect = (rows: unknown, key: string) => {
      for (const r of (rows ?? []) as Array<Record<string, unknown>>) {
        const id = r[key];
        if (typeof id === 'string') current.add(id);
      }
    };
    const { data: links } = await this.supabase.service
      .from('event_venues')
      .select('venue_id')
      .eq('event_id', eventId);
    collect(links, 'venue_id');
    const { data: liceVenues } = await this.supabase.service
      .from('lices')
      .select('venue_id')
      .eq('event_id', eventId)
      .not('venue_id', 'is', null);
    collect(liceVenues, 'venue_id');
    const { data: sessVenues } = await this.supabase.service
      .from('workshop_sessions')
      .select('venue_id, workshops!inner(event_id)')
      .eq('workshops.event_id', eventId)
      .not('venue_id', 'is', null);
    collect(sessVenues, 'venue_id');

    const toAdd = requested.filter((id) => !current.has(id));
    const toRemove = [...current].filter((id) => !requestedSet.has(id));
    const blocked: Array<{ venueId: string; reason: string }> = [];

    for (const venueId of toRemove) {
      const { data: liceIdRows } = await this.supabase.service
        .from('lices')
        .select('id')
        .eq('event_id', eventId)
        .eq('venue_id', venueId);
      const liceIds = ((liceIdRows ?? []) as Array<{ id: string }>).map((r) => String(r.id));
      let hasMatches = false;
      if (liceIds.length > 0) {
        const { count } = await this.supabase.service
          .from('matches')
          .select('id', { count: 'exact', head: true })
          .in('lice_id', liceIds);
        hasMatches = (count ?? 0) > 0;
      }
      const { count: sessCount } = await this.supabase.service
        .from('workshop_sessions')
        .select('id, workshops!inner(event_id)', { count: 'exact', head: true })
        .eq('workshops.event_id', eventId)
        .eq('venue_id', venueId);
      if (hasMatches || (sessCount ?? 0) > 0) {
        blocked.push({ venueId, reason: hasMatches ? 'scheduled matches' : 'workshop sessions' });
        continue;
      }
      // Safe: drop the explicit link + the event's (match-free) lices there.
      await this.supabase.service
        .from('event_venues')
        .delete()
        .eq('event_id', eventId)
        .eq('venue_id', venueId);
      if (liceIds.length > 0) {
        await this.supabase.service
          .from('lices')
          .delete()
          .eq('event_id', eventId)
          .eq('venue_id', venueId);
      }
    }

    for (const venueId of toAdd) {
      await this.supabase.service
        .from('event_venues')
        .insert({ event_id: eventId, venue_id: venueId });
      // Seed the event's lices from a tournament venue's catalogue (once).
      if (orgVenueById.get(venueId)?.hosts_tournament) {
        const { count: existing } = await this.supabase.service
          .from('lices')
          .select('id', { count: 'exact', head: true })
          .eq('event_id', eventId)
          .eq('venue_id', venueId);
        if ((existing ?? 0) === 0) {
          const { data: catalogue } = await this.supabase.service
            .from('venue_lices')
            .select('name, sort_order')
            .eq('venue_id', venueId)
            .order('sort_order', { ascending: true });
          const rows = (catalogue ?? []) as Array<{ name: string; sort_order: number | null }>;
          if (rows.length > 0) {
            await this.supabase.service.from('lices').insert(
              rows.map((l, index) => ({
                event_id: eventId,
                venue_id: venueId,
                name: l.name,
                sort_order: l.sort_order ?? index,
              })),
            );
          }
        }
      }
    }

    return { blocked };
  }

  /**
   * Idempotently link a single venue to an event (`event_venues`) and, for a
   * tournament-capable venue with none yet, seed the event's lices from the
   * venue's lice catalogue. Used when a tournament phase is assigned a venue so
   * the venue counts as part of the event and has pistes to schedule on. Asserts
   * the venue belongs to the event's org; the caller does the org-role check.
   */
  async ensureEventVenueLinked(eventId: string, venueId: string): Promise<void> {
    const { data: event, error: evErr } = await this.supabase.service
      .from('events')
      .select('id, organization_id')
      .eq('id', eventId)
      .maybeSingle();
    if (evErr) throw new BadRequestException(evErr.message);
    if (!event) throw new NotFoundException(`Event ${eventId} not found`);
    const orgId = String((event as Row)['organization_id']);

    const { data: venue, error: vErr } = await this.supabase.service
      .from('venues')
      .select('id, organization_id, hosts_tournament')
      .eq('id', venueId)
      .maybeSingle();
    if (vErr) throw new BadRequestException(vErr.message);
    if (!venue) throw new NotFoundException(`Venue ${venueId} not found`);
    if (String((venue as Row)['organization_id']) !== orgId) {
      throw new BadRequestException('Venue belongs to a different organization');
    }

    // Link (idempotent on UNIQUE(event_id, venue_id)).
    const { count: linkCount } = await this.supabase.service
      .from('event_venues')
      .select('id', { count: 'exact', head: true })
      .eq('event_id', eventId)
      .eq('venue_id', venueId);
    if ((linkCount ?? 0) === 0) {
      await this.supabase.service
        .from('event_venues')
        .insert({ event_id: eventId, venue_id: venueId });
    }

    // Seed the event's lices from the venue's catalogue once (tournament venues).
    if ((venue as Row)['hosts_tournament']) {
      const { count: existing } = await this.supabase.service
        .from('lices')
        .select('id', { count: 'exact', head: true })
        .eq('event_id', eventId)
        .eq('venue_id', venueId);
      if ((existing ?? 0) === 0) {
        const { data: catalogue } = await this.supabase.service
          .from('venue_lices')
          .select('name, sort_order')
          .eq('venue_id', venueId)
          .order('sort_order', { ascending: true });
        const rows = (catalogue ?? []) as Array<{ name: string; sort_order: number | null }>;
        if (rows.length > 0) {
          await this.supabase.service.from('lices').insert(
            rows.map((l, index) => ({
              event_id: eventId,
              venue_id: venueId,
              name: l.name,
              sort_order: l.sort_order ?? index,
            })),
          );
        }
      }
    }
  }

  // ── Tournament phase venues (pools / bracket can live at different venues) ────

  /**
   * The venue each phase-type of a tournament is assigned to run at. Public read
   * (powers the admin tournament-list "Venue(s)" column + the settings form).
   */
  async getTournamentPhaseVenues(tournamentId: string): Promise<TournamentPhaseVenues> {
    const { data, error } = await this.supabase.service
      .from('tournament_phase_venues')
      .select('phase_kind, venues(id, name)')
      .eq('tournament_id', tournamentId);
    if (error) throw new BadRequestException(error.message);
    const out: TournamentPhaseVenues = { pool: null, bracket: null };
    for (const row of (data ?? []) as unknown as Array<{
      phase_kind: string;
      venues: { id: string; name: string } | null;
    }>) {
      const venue = row.venues
        ? { id: String(row.venues.id), name: String(row.venues.name) }
        : null;
      if (row.phase_kind === 'pool') out.pool = venue;
      else if (row.phase_kind === 'bracket') out.bracket = venue;
    }
    return out;
  }

  /**
   * Set a tournament's per-phase venue (org-admin). An omitted key leaves that
   * phase unchanged; `null` clears it. Assigning a venue links it to the event +
   * seeds its lices (via {@link ensureEventVenueLinked}) so the phase has pistes
   * to schedule on. This stores intent only — existing matches are not moved.
   */
  async setTournamentPhaseVenues(
    tournamentId: string,
    assignments: { pool?: string | null; bracket?: string | null },
    userId: string,
  ): Promise<TournamentPhaseVenues> {
    const { data: tournament, error: tErr } = await this.supabase.service
      .from('tournaments')
      .select('id, event_id')
      .eq('id', tournamentId)
      .maybeSingle();
    if (tErr) throw new BadRequestException(tErr.message);
    if (!tournament) throw new NotFoundException(`Tournament ${tournamentId} not found`);
    const eventId = String((tournament as Row)['event_id']);

    const { data: event, error: evErr } = await this.supabase.service
      .from('events')
      .select('id, organization_id')
      .eq('id', eventId)
      .maybeSingle();
    if (evErr) throw new BadRequestException(evErr.message);
    if (!event) throw new NotFoundException(`Event ${eventId} not found`);
    const orgId = String((event as Row)['organization_id']);
    await this.orgs.assertOrgRole(orgId, userId, 'admin');

    // Validate any provided venue belongs to this org.
    const requestedVenueIds = [assignments.pool, assignments.bracket].filter(
      (v): v is string => typeof v === 'string',
    );
    if (requestedVenueIds.length > 0) {
      const { data: orgVenues } = await this.supabase.service
        .from('venues')
        .select('id')
        .eq('organization_id', orgId)
        .in('id', requestedVenueIds);
      const valid = new Set(((orgVenues ?? []) as Array<{ id: string }>).map((v) => String(v.id)));
      for (const id of requestedVenueIds) {
        if (!valid.has(id)) {
          throw new BadRequestException(`Venue ${id} is not in this organization`);
        }
      }
    }

    const kinds: Array<'pool' | 'bracket'> = ['pool', 'bracket'];
    for (const kind of kinds) {
      if (!(kind in assignments)) continue; // omitted → leave unchanged
      const venueId = assignments[kind] ?? null;
      if (venueId === null) {
        await this.supabase.service
          .from('tournament_phase_venues')
          .delete()
          .eq('tournament_id', tournamentId)
          .eq('phase_kind', kind);
        continue;
      }
      await this.supabase.service.from('tournament_phase_venues').upsert(
        {
          tournament_id: tournamentId,
          phase_kind: kind,
          venue_id: venueId,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'tournament_id,phase_kind' },
      );
      // Make the venue part of the event + give the phase pistes to schedule on.
      await this.ensureEventVenueLinked(eventId, venueId);
    }

    return this.getTournamentPhaseVenues(tournamentId);
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  private async assertCanManageVenue(venueId: string, userId: string): Promise<string> {
    const { data: venue, error } = await this.supabase.service
      .from('venues')
      .select('organization_id')
      .eq('id', venueId)
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!venue) throw new NotFoundException(`Venue ${venueId} not found`);
    const organizationId = String((venue as Row)['organization_id']);
    await this.orgs.assertOrgRole(organizationId, userId, 'admin');
    return organizationId;
  }

  private async assertCanManageArea(areaId: string, userId: string): Promise<string> {
    const { data: area, error } = await this.supabase.service
      .from('venue_areas')
      .select('venue_id, venues!inner(organization_id)')
      .eq('id', areaId)
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!area) throw new NotFoundException(`Area ${areaId} not found`);
    const venueId = String((area as Row)['venue_id']);
    const venue = (area as Row)['venues'] as Row | null;
    const organizationId = venue ? String(venue['organization_id']) : '';
    await this.orgs.assertOrgRole(organizationId, userId, 'admin');
    return venueId;
  }

  private async assertCanManageLice(liceId: string, userId: string): Promise<string> {
    const { data: lice, error } = await this.supabase.service
      .from('venue_lices')
      .select('venue_id, venues!inner(organization_id)')
      .eq('id', liceId)
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!lice) throw new NotFoundException(`Lice ${liceId} not found`);
    const venueId = String((lice as Row)['venue_id']);
    const venue = (lice as Row)['venues'] as Row | null;
    const organizationId = venue ? String(venue['organization_id']) : '';
    await this.orgs.assertOrgRole(organizationId, userId, 'admin');
    return venueId;
  }

  private async isVenueInUse(venueId: string): Promise<{ detail: string } | null> {
    const { count: liceCount, error: liceErr } = await this.supabase.service
      .from('lices')
      .select('id', { count: 'exact', head: true })
      .eq('venue_id', venueId);
    if (liceErr) throw new BadRequestException(liceErr.message);
    const { count: sessionCount, error: sessionErr } = await this.supabase.service
      .from('workshop_sessions')
      .select('id', { count: 'exact', head: true })
      .eq('venue_id', venueId);
    if (sessionErr) throw new BadRequestException(sessionErr.message);

    const parts: string[] = [];
    if ((liceCount ?? 0) > 0) parts.push(`${liceCount} lice(s)`);
    if ((sessionCount ?? 0) > 0) parts.push(`${sessionCount} workshop session(s)`);
    if (parts.length === 0) return null;
    return { detail: parts.join(' and ') };
  }
}
