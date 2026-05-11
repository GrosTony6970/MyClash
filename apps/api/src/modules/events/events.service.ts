import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { OrganizationsService } from '../organizations/organizations.service';
import { NotificationEventsService } from '../notifications/event-handlers/notification-events.service';
import { LeaguesService } from '../leagues/leagues.service';
import type {
  CreateEventDto,
  CreateTournamentDto,
  EventQueryDto,
  UpdateEventDto,
  UpdateTournamentDto,
} from './dto/events.dto';
import {
  normalizeTournamentLockConfig,
  normalizeTournamentScoringConfig,
  validateTournamentRulesetConfig,
} from './tournament-config';

@Injectable()
export class EventsService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly orgs: OrganizationsService,
    private readonly notificationEvents: NotificationEventsService,
    private readonly leagues?: LeaguesService,
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
    const query = this.supabase.service
      .from('events')
      .select('*, organizations(name, slug), themes(*), lices(*)');
    const isUuid =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(slug);
    const { data, error } = await (
      isUuid ? query.eq('id', slug) : query.eq('slug', slug)
    ).maybeSingle();

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

    if (existing)
      throw new ConflictException(`Event slug "${dto.slug}" already exists in this organization`);

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
    await this.orgs.assertOrgRole(
      (event as { organization_id: string }).organization_id,
      userId,
      'admin',
    );

    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (dto.name !== undefined) updates['name'] = dto.name.trim();
    if (dto.location !== undefined) updates['location'] = dto.location;
    if (dto.startDate !== undefined) updates['start_date'] = dto.startDate;
    if (dto.endDate !== undefined) updates['end_date'] = dto.endDate;
    if (dto.publicLandingMd !== undefined) updates['public_landing_md'] = dto.publicLandingMd;
    if (dto.status !== undefined) updates['status'] = dto.status;
    if (dto.aiSpendCapEur !== undefined) updates['ai_spend_cap_eur'] = dto.aiSpendCapEur;

    const { data, error } = await this.supabase.service
      .from('events')
      .update(updates)
      .eq('id', eventId)
      .select('*')
      .single();

    if (error) throw new BadRequestException(error.message);
    if (dto.status === 'completed') {
      await this.leagues?.recomputeForEvent(eventId);
    }
    return data;
  }

  async publishEvent(eventId: string, userId: string) {
    const event = await this.getEventById(eventId);
    await this.orgs.assertOrgRole(
      (event as { organization_id: string }).organization_id,
      userId,
      'admin',
    );

    const { data, error } = await this.supabase.service
      .from('events')
      .update({ status: 'published', updated_at: new Date().toISOString() })
      .eq('id', eventId)
      .select('*')
      .single();

    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async getPublicTournamentStandings(eventSlug: string, tournamentSlug: string) {
    const event = await this.getEventBySlug(eventSlug);
    const eventId = (event as { id: string }).id;

    const { data: tournament, error: tournamentError } = await this.supabase.service
      .from('tournaments')
      .select('id, name, weapon, ruleset_code, status')
      .eq('event_id', eventId)
      .eq('slug', tournamentSlug)
      .maybeSingle();
    if (tournamentError) throw new BadRequestException(tournamentError.message);
    if (!tournament) throw new NotFoundException(`Tournament ${tournamentSlug} not found`);

    const { data: phases, error: phasesError } = await this.supabase.service
      .from('phases')
      .select('id, type, visibility_status, config_json')
      .eq('tournament_id', (tournament as { id: string }).id)
      .eq('visibility_status', 'published');
    if (phasesError) throw new BadRequestException(phasesError.message);

    const phaseRows = (phases ?? []) as Array<Record<string, unknown>>;
    const poolPhase = phaseRows.find((phase) => phase['type'] === 'pool');
    const bracketPhase = phaseRows.find((phase) => phase['type'] === 'single_elim');

    const pools =
      poolPhase && typeof poolPhase['id'] === 'string'
        ? await this.getPublishedPools(poolPhase['id'])
        : [];
    const bracket =
      bracketPhase && typeof bracketPhase['id'] === 'string'
        ? await this.getPublishedBracket(bracketPhase)
        : { bracketSlots: [], bracketSize: 0, bracketRounds: 0 };

    return {
      tournament: {
        id: tournament['id'],
        name: tournament['name'],
        weapon: tournament['weapon'],
        rulesetCode: tournament['ruleset_code'],
        status: tournament['status'],
      },
      pools,
      ...bracket,
    };
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

  private async getPublishedPools(phaseId: string) {
    const { data, error } = await this.supabase.service
      .from('pools')
      .select('id, name')
      .eq('phase_id', phaseId)
      .order('sort_order', { ascending: true });
    if (error) throw new BadRequestException(error.message);
    return ((data ?? []) as Array<Record<string, unknown>>).map((pool) => ({
      id: pool['id'],
      name: pool['name'],
      standings: [],
    }));
  }

  private async getPublishedBracket(phase: Record<string, unknown>) {
    const { data, error } = await this.supabase.service
      .from('bracket_slots')
      .select('id, round, position')
      .eq('phase_id', phase['id'] as string)
      .order('round', { ascending: true });
    if (error) throw new BadRequestException(error.message);
    const config = (phase['config_json'] ?? {}) as Record<string, unknown>;
    return {
      bracketSlots: (data ?? []).map((slot) => ({
        id: slot['id'],
        round: slot['round'],
        position: slot['position'],
        redFighterName: null,
        blueFighterName: null,
        redScore: null,
        blueScore: null,
        status: 'scheduled',
        matchId: null,
      })),
      bracketSize: Number(config['bracketSize'] ?? 0),
      mainBracketSize: Number(config['mainBracketSize'] ?? config['bracketSize'] ?? 0),
      byeCount: Number(config['byeCount'] ?? 0),
      byeSeedCount: Number(config['byeSeedCount'] ?? 0),
      playInMatchCount: Number(config['playInMatchCount'] ?? 0),
      hasPlayInRound: Boolean(config['hasPlayInRound'] ?? false),
      bracketRounds: Number(config['rounds'] ?? 0),
    };
  }

  async createTournament(eventId: string, dto: CreateTournamentDto, userId: string) {
    const event = await this.getEventById(eventId);
    await this.orgs.assertOrgRole(
      (event as { organization_id: string }).organization_id,
      userId,
      'admin',
    );

    const { data: existing } = await this.supabase.service
      .from('tournaments')
      .select('id')
      .eq('event_id', eventId)
      .eq('slug', dto.slug)
      .maybeSingle();

    if (existing)
      throw new ConflictException(`Tournament slug "${dto.slug}" already exists in this event`);

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
      .select('event_id, ruleset_code')
      .eq('id', tournamentId)
      .maybeSingle();

    if (!tournament) throw new NotFoundException(`Tournament ${tournamentId} not found`);

    const event = await this.getEventById((tournament as { event_id: string }).event_id);
    await this.orgs.assertOrgRole(
      (event as { organization_id: string }).organization_id,
      userId,
      'admin',
    );

    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (dto.name !== undefined) updates['name'] = dto.name.trim();
    if (dto.weapon !== undefined) updates['weapon'] = dto.weapon;
    if (dto.category !== undefined) updates['category'] = dto.category;
    if (dto.status !== undefined) updates['status'] = dto.status;
    if (dto.scoringConfig !== undefined) {
      updates['scoring_config_json'] = normalizeTournamentScoringConfig(dto.scoringConfig);
    }
    if (dto.lockConfig !== undefined) {
      updates['lock_config_json'] = normalizeTournamentLockConfig(dto.lockConfig);
    }
    if (dto.rulesetConfig !== undefined) {
      updates['ruleset_config'] = validateTournamentRulesetConfig(
        (tournament as { ruleset_code?: string }).ruleset_code ?? 'TF_v1',
        dto.rulesetConfig,
      );
    }

    const { data, error } = await this.supabase.service
      .from('tournaments')
      .update(updates)
      .eq('id', tournamentId)
      .select('*')
      .single();

    if (error) throw new BadRequestException(error.message);
    if (dto.status === 'completed') {
      await this.notificationEvents.resultsPublished(tournamentId);
    }
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
