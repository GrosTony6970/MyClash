import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { OrganizationsService } from '../organizations/organizations.service';
import type {
  CreateEventDto,
  CreateTournamentDto,
  EventQueryDto,
  UpdateEventDto,
  UpdateTournamentDto,
} from './dto/events.dto';

@Injectable()
export class EventsService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly orgs: OrganizationsService,
  ) {}

  // ── Events ───────────────────────────────────────────────────────────────────

  async listEvents(query: EventQueryDto) {
    let q = this.supabase.service
      .from('events')
      .select('*, organizations(name, slug)')
      .order('start_date', { ascending: false });

    if (query.status) q = q.eq('status', query.status) as typeof q;
    else q = q.in('status', ['published', 'running', 'completed']) as typeof q;

    if (query.organizationId) q = q.eq('organization_id', query.organizationId) as typeof q;

    const { data, error } = await q;
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  async getEventBySlug(slug: string) {
    const { data, error } = await this.supabase.service
      .from('events')
      .select('*, organizations(name, slug), themes(*), lices(*)')
      .eq('slug', slug)
      .maybeSingle();

    if (error) throw new BadRequestException(error.message);
    if (!data) throw new NotFoundException(`Event "${slug}" not found`);
    return data;
  }

  async createEvent(orgId: string, dto: CreateEventDto, userId: string) {
    // Verify user is a member of the organization
    await this.orgs.assertOrgRole(orgId, userId, 'admin');

    // Check slug uniqueness within org
    const { data: existing } = await this.supabase.service
      .from('events')
      .select('id')
      .eq('organization_id', orgId)
      .eq('slug', dto.slug)
      .maybeSingle();

    if (existing) throw new ConflictException(`Event slug "${dto.slug}" already exists in this organization`);

    const { data, error } = await this.supabase.service
      .from('events')
      .insert({
        organization_id: orgId,
        slug: dto.slug,
        name: dto.name.trim(),
        start_date: dto.startDate,
        end_date: dto.endDate,
        location: dto.location ?? null,
        public_landing_md: dto.publicLandingMd ?? null,
        status: 'draft',
      })
      .select('*')
      .single();

    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async updateEvent(eventId: string, dto: UpdateEventDto, userId: string) {
    const event = await this.getEventById(eventId);
    await this.orgs.assertOrgRole((event as { organization_id: string }).organization_id, userId, 'admin');

    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (dto.name !== undefined) updates['name'] = dto.name.trim();
    if (dto.location !== undefined) updates['location'] = dto.location;
    if (dto.startDate !== undefined) updates['start_date'] = dto.startDate;
    if (dto.endDate !== undefined) updates['end_date'] = dto.endDate;
    if (dto.publicLandingMd !== undefined) updates['public_landing_md'] = dto.publicLandingMd;

    const { data, error } = await this.supabase.service
      .from('events')
      .update(updates)
      .eq('id', eventId)
      .select('*')
      .single();

    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async publishEvent(eventId: string, userId: string) {
    const event = await this.getEventById(eventId);
    await this.orgs.assertOrgRole((event as { organization_id: string }).organization_id, userId, 'admin');

    const { data, error } = await this.supabase.service
      .from('events')
      .update({ status: 'published', updated_at: new Date().toISOString() })
      .eq('id', eventId)
      .select('*')
      .single();

    if (error) throw new BadRequestException(error.message);
    return data;
  }

  // ── Tournaments ───────────────────────────────────────────────────────────────

  async listTournaments(eventId: string) {
    const { data, error } = await this.supabase.service
      .from('tournaments')
      .select('*')
      .eq('event_id', eventId)
      .order('sort_order', { ascending: true });

    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  async createTournament(eventId: string, dto: CreateTournamentDto, userId: string) {
    const event = await this.getEventById(eventId);
    await this.orgs.assertOrgRole((event as { organization_id: string }).organization_id, userId, 'admin');

    const { data: existing } = await this.supabase.service
      .from('tournaments')
      .select('id')
      .eq('event_id', eventId)
      .eq('slug', dto.slug)
      .maybeSingle();

    if (existing) throw new ConflictException(`Tournament slug "${dto.slug}" already exists in this event`);

    const { data, error } = await this.supabase.service
      .from('tournaments')
      .insert({
        event_id: eventId,
        slug: dto.slug,
        name: dto.name.trim(),
        weapon: dto.weapon ?? null,
        category: dto.category ?? null,
        ruleset_code: dto.rulesetCode ?? 'TF_v1',
        ruleset_version: dto.rulesetVersion ?? '1',
        status: 'draft',
      })
      .select('*')
      .single();

    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async updateTournament(tournamentId: string, dto: UpdateTournamentDto, userId: string) {
    const { data: tournament } = await this.supabase.service
      .from('tournaments')
      .select('event_id')
      .eq('id', tournamentId)
      .maybeSingle();

    if (!tournament) throw new NotFoundException(`Tournament ${tournamentId} not found`);

    const event = await this.getEventById((tournament as { event_id: string }).event_id);
    await this.orgs.assertOrgRole((event as { organization_id: string }).organization_id, userId, 'admin');

    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (dto.name !== undefined) updates['name'] = dto.name.trim();
    if (dto.weapon !== undefined) updates['weapon'] = dto.weapon;
    if (dto.category !== undefined) updates['category'] = dto.category;
    if (dto.status !== undefined) updates['status'] = dto.status;

    const { data, error } = await this.supabase.service
      .from('tournaments')
      .update(updates)
      .eq('id', tournamentId)
      .select('*')
      .single();

    if (error) throw new BadRequestException(error.message);
    return data;
  }

  // ── Private helpers ──────────────────────────────────────────────────────────

  private async getEventById(eventId: string) {
    const { data, error } = await this.supabase.service
      .from('events')
      .select('id, organization_id, status')
      .eq('id', eventId)
      .maybeSingle();

    if (error) throw new BadRequestException(error.message);
    if (!data) throw new NotFoundException(`Event ${eventId} not found`);
    return data;
  }
}
