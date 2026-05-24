import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { OrganizationsService } from '../organizations/organizations.service';
import { NotificationEventsService } from '../notifications/event-handlers/notification-events.service';
import { LeaguesService } from '../leagues/leagues.service';
import { ClubsService } from '../clubs/clubs.service';
import type {
  CreateEventDto,
  CreateTournamentDto,
  EventClubQueryDto,
  EventQueryDto,
  SubmitEventClubRequestDto,
  UpdateEventDto,
  UpdateTournamentDto,
} from './dto/events.dto';
import {
  normalizeTournamentLockConfig,
  normalizeTournamentScoringConfig,
  validateTournamentRulesetConfig,
} from './tournament-config';
import { deepMergeJson } from '../../common/deep-merge';
import {
  freezeRulesetVersion,
  normalizeRulesetVersion,
  resolveRulesetConfigDefaults,
} from './ruleset-defaults';

@Injectable()
export class EventsService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly orgs: OrganizationsService,
    private readonly notificationEvents: NotificationEventsService,
    private readonly leagues?: LeaguesService,
    private readonly clubs?: ClubsService,
  ) {}

  // ── Events ───────────────────────────────────────────────────────────────────

  async listEvents(query: EventQueryDto) {
    let q = this.supabase.service
      .from('events')
      .select('*, organizations(name, slug)')
      .order('start_date', { ascending: false });

    if (query.status && query.status !== 'all') q = q.eq('status', query.status) as typeof q;
    else q = q.in('status', ['published', 'running', 'completed']) as typeof q;

    if (query.organizationId) q = q.eq('organization_id', query.organizationId) as typeof q;

    const { data, error } = await q;
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  async listOrgEvents(orgId: string, userId: string) {
    await this.orgs.assertOrgRole(orgId, userId, 'scorekeeper');
    const { data, error } = await this.supabase.service
      .from('events')
      .select('*, organizations(name, slug)')
      .eq('organization_id', orgId)
      .order('start_date', { ascending: false });
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

  async unpublishEvent(eventId: string, userId: string) {
    const event = await this.getEventById(eventId);
    await this.orgs.assertOrgRole(
      (event as { organization_id: string }).organization_id,
      userId,
      'admin',
    );

    const { data, error } = await this.supabase.service
      .from('events')
      .update({ status: 'draft', updated_at: new Date().toISOString() })
      .eq('id', eventId)
      .select('*')
      .single();

    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async getEventDashboardStats(eventId: string, userId: string) {
    const event = (await this.getEventById(eventId)) as {
      id: string;
      organization_id: string;
      status: string;
      name?: string;
      slug?: string;
      start_date?: string;
      end_date?: string;
      location?: string | null;
    };
    await this.orgs.assertOrgRole(event.organization_id, userId, 'scorekeeper');

    const tournaments = await this.getEventTournaments(eventId);
    const tournamentIds = tournaments.map((tournament) => tournament.id);
    const [registrations, persons, refereeQualifications, refereeCounts, phases] =
      await Promise.all([
        this.getRegistrationsForTournaments(tournamentIds),
        this.getEventPersons(eventId),
        this.countRefereeQualifications(eventId),
        this.countTournamentRefereeAssignments(eventId, tournamentIds),
        this.getPhasesForTournaments(tournamentIds),
      ]);

    const registrationsByTournament = new Map<string, number>();
    for (const registration of registrations) {
      if (['withdrawn', 'disqualified'].includes(registration.status ?? '')) continue;
      registrationsByTournament.set(
        registration.tournament_id,
        (registrationsByTournament.get(registration.tournament_id) ?? 0) + 1,
      );
    }

    const representedClubIds = new Set(
      persons.map((person) => person.club_id).filter((clubId): clubId is string => Boolean(clubId)),
    );

    // Index phases by tournament. A tournament has at most one pool phase
    // and at most one elim phase (single_elim or double_elim).
    const poolPhaseByTournament = new Map<string, { id: string }>();
    const elimPhaseByTournament = new Map<
      string,
      { id: string; type: string; config_json: Record<string, unknown> | null }
    >();
    for (const phase of phases) {
      if (phase.type === 'pool') {
        poolPhaseByTournament.set(phase.tournament_id, { id: phase.id });
      } else if (phase.type === 'single_elim' || phase.type === 'double_elim') {
        elimPhaseByTournament.set(phase.tournament_id, {
          id: phase.id,
          type: phase.type,
          config_json: phase.config_json,
        });
      }
    }

    // Count pools per pool-phase (single batched query bounded by the
    // number of tournaments that already generated their pool phase).
    const poolPhaseIds = Array.from(poolPhaseByTournament.values()).map((p) => p.id);
    const poolCountByPhase = new Map<string, number>();
    if (poolPhaseIds.length > 0) {
      const { data: poolRows, error: poolsErr } = await this.supabase.service
        .from('pools')
        .select('id, phase_id')
        .in('phase_id', poolPhaseIds);
      if (poolsErr) throw new BadRequestException(poolsErr.message);
      for (const row of (poolRows ?? []) as Array<{ phase_id: string }>) {
        poolCountByPhase.set(row.phase_id, (poolCountByPhase.get(row.phase_id) ?? 0) + 1);
      }
    }

    return {
      event: {
        id: event.id,
        name: event.name ?? null,
        slug: event.slug ?? null,
        status: event.status,
        startDate: event.start_date ?? null,
        endDate: event.end_date ?? null,
        location: event.location ?? null,
      },
      totals: {
        tournaments: tournaments.length,
        registeredFighters: registrations.filter(
          (registration) => !['withdrawn', 'disqualified'].includes(registration.status ?? ''),
        ).length,
        qualifiedReferees: refereeQualifications,
        clubsRepresented: representedClubIds.size,
      },
      tournaments: tournaments.map((tournament) => {
        const poolPhase = poolPhaseByTournament.get(tournament.id);
        const elimPhase = elimPhaseByTournament.get(tournament.id);
        const bracketSize = elimPhase
          ? ((elimPhase.config_json?.['bracketSize'] as number | undefined) ?? null)
          : null;
        return {
          id: tournament.id,
          name: tournament.name,
          slug: tournament.slug,
          status: tournament.status,
          color: tournament.color ?? null,
          rulesetCode: tournament.ruleset_code ?? null,
          poolCount: poolPhase ? (poolCountByPhase.get(poolPhase.id) ?? 0) : 0,
          bracketSize,
          eliminationType: elimPhase ? elimPhase.type : null,
          fighterCount: registrationsByTournament.get(tournament.id) ?? 0,
          assignedRefereeCount: refereeCounts.get(tournament.id) ?? 0,
        };
      }),
    };
  }

  /**
   * Phases for a set of tournaments. Used by the event dashboard to count
   * pools (via the pool phase) and surface elim bracket size + type (via
   * the elim phase's `config_json`).
   */
  private async getPhasesForTournaments(tournamentIds: string[]) {
    if (tournamentIds.length === 0) {
      return [] as Array<{
        id: string;
        tournament_id: string;
        type: string;
        config_json: Record<string, unknown> | null;
      }>;
    }
    const { data, error } = await this.supabase.service
      .from('phases')
      .select('id, tournament_id, type, config_json')
      .in('tournament_id', tournamentIds);
    if (error) throw new BadRequestException(error.message);
    return (data ?? []) as Array<{
      id: string;
      tournament_id: string;
      type: string;
      config_json: Record<string, unknown> | null;
    }>;
  }

  async listEventClubs(eventId: string, query: EventClubQueryDto, userId: string) {
    const event = (await this.getEventById(eventId)) as { organization_id: string };
    await this.orgs.assertOrgRole(event.organization_id, userId, 'scorekeeper');

    const scope = query.scope ?? 'all';
    const eventPersons = await this.getEventPersons(eventId);
    const personsByClub = new Map<string, typeof eventPersons>();
    for (const person of eventPersons) {
      if (!person.club_id) continue;
      const group = personsByClub.get(person.club_id) ?? [];
      group.push(person);
      personsByClub.set(person.club_id, group);
    }

    const clubs = await this.getClubsForEventScope(
      scope,
      query.q,
      Array.from(personsByClub.keys()),
    );

    // Fetch the GLOBAL members of every club we're about to return so the
    // UI can show "all the club's fighters" with an `inEvent` flag — letting
    // an organiser see at a glance which global members are not yet on the
    // event roster. Single batched query bounded by the club count.
    const clubIds = clubs.map((club) => (club as { id: string }).id);
    const globalsByClub = new Map<
      string,
      Array<{
        id: string;
        given_name: string;
        family_name: string;
        email: string | null;
      }>
    >();
    if (clubIds.length > 0) {
      const { data: globals, error: globalsErr } = await this.supabase.service
        .from('global_persons')
        .select('id, club_id, given_name, family_name, email')
        .in('club_id', clubIds);
      if (globalsErr) throw new BadRequestException(globalsErr.message);
      const rows = (globals ?? []) as Array<{
        id: string;
        club_id: string | null;
        given_name: string;
        family_name: string;
        email: string | null;
      }>;
      for (const g of rows) {
        if (!g.club_id) continue;
        const arr = globalsByClub.get(g.club_id) ?? [];
        arr.push({
          id: g.id,
          given_name: g.given_name,
          family_name: g.family_name,
          email: g.email,
        });
        globalsByClub.set(g.club_id, arr);
      }
    }

    // Index event_persons that have a global_person_id so we can quickly
    // mark the global rows as "in event".
    const eventGlobalIds = new Set<string>();
    for (const p of eventPersons) {
      if (p.global_person_id) eventGlobalIds.add(p.global_person_id);
    }

    return clubs.map((club) => {
      const eventFighters = personsByClub.get(club.id) ?? [];
      const globalFighters = globalsByClub.get(club.id) ?? [];

      // Start from the global members (canonical list).
      const seenGlobalIds = new Set<string>();
      const merged = globalFighters.map((g) => {
        seenGlobalIds.add(g.id);
        return {
          id: g.id,
          givenName: g.given_name,
          familyName: g.family_name,
          email: g.email ?? '',
          claimStatus: 'global',
          inEvent: eventGlobalIds.has(g.id),
        };
      });
      // Add any event-roster persons that don't link to a global row in
      // this same club (unclaimed guests, or stale links).
      for (const p of eventFighters) {
        if (p.global_person_id && seenGlobalIds.has(p.global_person_id)) continue;
        merged.push({
          id: p.id,
          givenName: p.given_name,
          familyName: p.family_name,
          email: p.email,
          claimStatus: p.claim_status,
          inEvent: true,
        });
      }

      return {
        ...club,
        eventFighterCount: eventFighters.length,
        fighters: merged,
      };
    });
  }

  async submitClubReviewRequest(eventId: string, dto: SubmitEventClubRequestDto, userId: string) {
    if (!this.clubs) throw new BadRequestException('Club service unavailable');
    const event = (await this.getEventById(eventId)) as {
      organization_id: string;
    };
    await this.orgs.assertOrgRole(event.organization_id, userId, 'admin');

    const club = (await this.clubs.createUnverified(dto)) as { id: string };
    const { data, error } = await this.supabase.service
      .from('club_review_requests')
      .insert({
        event_id: eventId,
        organization_id: event.organization_id,
        proposed_club_id: club.id,
        requester_user_id: userId,
        status: 'pending',
      })
      .select('*')
      .single();

    if (error) throw new BadRequestException(error.message);
    return { request: data, club };
  }

  async deleteEvent(eventId: string, mode: string | undefined, userId: string) {
    if (mode !== 'hard') {
      throw new BadRequestException('Event deletion requires mode=hard');
    }

    const event = await this.getEventById(eventId);
    if ((event as { status: string }).status === 'archived') {
      throw new ForbiddenException(
        'Archived events require super-admin approval. Submit a deletion request.',
      );
    }

    await this.orgs.assertOrgRole(
      (event as { organization_id: string }).organization_id,
      userId,
      'admin',
    );

    const { error } = await this.supabase.service.from('events').delete().eq('id', eventId);
    if (error) throw new BadRequestException(error.message);
    return { deleted: true, id: eventId };
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

  private async getEventTournaments(eventId: string) {
    const { data, error } = await this.supabase.service
      .from('tournaments')
      .select('id, slug, name, status, color, ruleset_code')
      .eq('event_id', eventId)
      .order('sort_order', { ascending: true });
    if (error) throw new BadRequestException(error.message);
    return (data ?? []) as Array<{
      id: string;
      slug: string;
      name: string;
      status: string;
      color: string | null;
      ruleset_code: string | null;
    }>;
  }

  private async getRegistrationsForTournaments(tournamentIds: string[]) {
    if (tournamentIds.length === 0) {
      return [] as Array<{ tournament_id: string; person_id: string; status: string }>;
    }
    const { data, error } = await this.supabase.service
      .from('registrations')
      .select('tournament_id, person_id, status')
      .in('tournament_id', tournamentIds);
    if (error) throw new BadRequestException(error.message);
    return (data ?? []) as Array<{ tournament_id: string; person_id: string; status: string }>;
  }

  private async getEventPersons(eventId: string) {
    const { data, error } = await this.supabase.service
      .from('persons')
      .select('id, given_name, family_name, email, club_id, claim_status, global_person_id')
      .eq('event_id', eventId)
      .order('family_name', { ascending: true });
    if (error) throw new BadRequestException(error.message);
    return (data ?? []) as Array<{
      id: string;
      given_name: string;
      family_name: string;
      email: string;
      club_id: string | null;
      claim_status: string;
      global_person_id: string | null;
    }>;
  }

  private async countRefereeQualifications(eventId: string) {
    const { count, error } = await this.supabase.service
      .from('referee_qualifications')
      .select('id', { count: 'exact', head: true })
      .eq('event_id', eventId);
    if (error) throw new BadRequestException(error.message);
    return count ?? 0;
  }

  private async countTournamentRefereeAssignments(eventId: string, tournamentIds: string[]) {
    const counts = new Map<string, number>();
    for (const id of tournamentIds) counts.set(id, 0);
    if (tournamentIds.length === 0) return counts;

    const { data: phases, error: phasesError } = await this.supabase.service
      .from('phases')
      .select('id, tournament_id')
      .in('tournament_id', tournamentIds);
    if (phasesError) throw new BadRequestException(phasesError.message);

    const phaseRows = (phases ?? []) as Array<{ id: string; tournament_id: string }>;
    const phaseToTournament = new Map(phaseRows.map((phase) => [phase.id, phase.tournament_id]));
    if (phaseRows.length === 0) return counts;

    const phaseIds = phaseRows.map((phase) => phase.id);
    const { data: pools, error: poolsError } = await this.supabase.service
      .from('pools')
      .select('id, phase_id')
      .in('phase_id', phaseIds);
    if (poolsError) throw new BadRequestException(poolsError.message);

    const poolToTournament = new Map<string, string>();
    for (const pool of (pools ?? []) as Array<{ id: string; phase_id: string }>) {
      const tournamentId = phaseToTournament.get(pool.phase_id);
      if (tournamentId) poolToTournament.set(pool.id, tournamentId);
    }

    const { data: matches, error: matchesError } = await this.supabase.service
      .from('matches')
      .select('id, phase_id')
      .in('phase_id', phaseIds);
    if (matchesError) throw new BadRequestException(matchesError.message);

    const matchToTournament = new Map<string, string>();
    for (const match of (matches ?? []) as Array<{ id: string; phase_id: string }>) {
      const tournamentId = phaseToTournament.get(match.phase_id);
      if (tournamentId) matchToTournament.set(match.id, tournamentId);
    }

    const { data: assignments, error: assignmentsError } = await this.supabase.service
      .from('referee_assignments')
      .select('user_id, pool_id, match_id')
      .eq('event_id', eventId);
    if (assignmentsError) throw new BadRequestException(assignmentsError.message);

    const usersByTournament = new Map<string, Set<string>>();
    for (const assignment of (assignments ?? []) as Array<{
      user_id: string;
      pool_id: string | null;
      match_id: string | null;
    }>) {
      const tournamentId =
        (assignment.pool_id ? poolToTournament.get(assignment.pool_id) : undefined) ??
        (assignment.match_id ? matchToTournament.get(assignment.match_id) : undefined);
      if (!tournamentId) continue;
      const users = usersByTournament.get(tournamentId) ?? new Set<string>();
      users.add(assignment.user_id);
      usersByTournament.set(tournamentId, users);
    }

    for (const [tournamentId, users] of usersByTournament) counts.set(tournamentId, users.size);
    return counts;
  }

  private async getClubsForEventScope(
    scope: 'all' | 'event',
    q: string | undefined,
    clubIds: string[],
  ) {
    if (scope === 'event' && clubIds.length === 0) {
      return [] as Array<Record<string, unknown> & { id: string }>;
    }

    let query = this.supabase.service.from('clubs').select('*').is('archived_at', null);
    if (scope === 'event') query = query.in('id', clubIds) as typeof query;
    if (q?.trim()) {
      const value = q.trim();
      query = query.or(`name.ilike.%${value}%,abbreviation.ilike.%${value}%`) as typeof query;
    }
    const { data, error } = await query.order('name', { ascending: true });
    if (error) throw new BadRequestException(error.message);
    return (data ?? []) as Array<Record<string, unknown> & { id: string }>;
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

    // Seed ruleset_config from the ruleset's defaults so a freshly created
    // tournament inherits per-ruleset match-format defaults (and any
    // doublePenaltyFormula on custom rulesets) out of the box.
    const code = dto.rulesetCode ?? 'TF_v1';
    const version = normalizeRulesetVersion(dto.rulesetVersion ?? '1');
    const rulesetConfig = await resolveRulesetConfigDefaults(this.supabase, code, version);

    const { data, error } = await this.supabase.service
      .from('tournaments')
      .insert({
        event_id: eventId,
        slug: dto.slug,
        name: dto.name.trim(),
        weapon: dto.weapon ?? null,
        ruleset_code: code,
        ruleset_version: dto.rulesetVersion ?? '1',
        penalty_ruleset_id: dto.penaltyRulesetId ?? null,
        color: dto.color ?? null,
        status: 'draft',
        ruleset_config: rulesetConfig,
      })
      .select('*')
      .single();

    if (error) throw new BadRequestException(error.message);

    // Pin the ruleset version: subsequent edits to (code, version) must
    // bump a new version instead of mutating in place.
    await freezeRulesetVersion(this.supabase, code, dto.rulesetVersion ?? '1');

    return data;
  }

  /**
   * Return the full tournament row to a scorekeeper+ of the owning org.
   *
   * Used by the tournament-creation wizard's step 2 to hydrate the
   * match-format form against the row just created. Mirrors the read +
   * org-role assertion that updateTournament does at the top, but with a
   * lower role threshold (scorekeeper, not admin) — read access should be
   * available to anyone running the tournament, not just admins.
   */
  async getTournamentById(tournamentId: string, userId: string) {
    const { data, error } = await this.supabase.service
      .from('tournaments')
      .select('*')
      .eq('id', tournamentId)
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!data) throw new NotFoundException(`Tournament ${tournamentId} not found`);
    const event = await this.getEventById((data as { event_id: string }).event_id);
    await this.orgs.assertOrgRole(
      (event as { organization_id: string }).organization_id,
      userId,
      'scorekeeper',
    );
    return data;
  }

  async updateTournament(tournamentId: string, dto: UpdateTournamentDto, userId: string) {
    // Read the full current row so we can deep-merge any nested JSONB fields the
    // caller included in the patch. Without this, a wizard step saving only one
    // nested key would wipe everything else under that JSONB column.
    const { data: current, error: readError } = await this.supabase.service
      .from('tournaments')
      .select('*')
      .eq('id', tournamentId)
      .maybeSingle();

    if (readError) throw new BadRequestException(readError.message);
    if (!current) throw new NotFoundException(`Tournament ${tournamentId} not found`);

    const event = await this.getEventById((current as { event_id: string }).event_id);
    await this.orgs.assertOrgRole(
      (event as { organization_id: string }).organization_id,
      userId,
      'admin',
    );

    const currentJson = current as Record<string, unknown>;
    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (dto.name !== undefined) updates['name'] = dto.name.trim();
    if (dto.weapon !== undefined) updates['weapon'] = dto.weapon;
    if (dto.status !== undefined) updates['status'] = dto.status;
    if (dto.rulesetCode !== undefined) updates['ruleset_code'] = dto.rulesetCode;
    if (dto.rulesetVersion !== undefined) updates['ruleset_version'] = dto.rulesetVersion;
    if (dto.penaltyRulesetId !== undefined) updates['penalty_ruleset_id'] = dto.penaltyRulesetId;
    if (dto.color !== undefined) updates['color'] = dto.color;

    if (dto.scoringConfig !== undefined) {
      const merged = deepMergeJson(currentJson['scoring_config_json'] ?? {}, dto.scoringConfig);
      updates['scoring_config_json'] = normalizeTournamentScoringConfig(merged);
    }
    if (dto.lockConfig !== undefined) {
      const merged = deepMergeJson(currentJson['lock_config_json'] ?? {}, dto.lockConfig);
      updates['lock_config_json'] = normalizeTournamentLockConfig(merged);
    }
    const currentCode = currentJson['ruleset_code'] as string | undefined;
    const currentVersionRaw = currentJson['ruleset_version'] as string | undefined;
    const currentVersion = currentVersionRaw
      ? normalizeRulesetVersion(currentVersionRaw)
      : undefined;
    const dtoVersion = dto.rulesetVersion ? normalizeRulesetVersion(dto.rulesetVersion) : undefined;
    const codeChanged = dto.rulesetCode !== undefined && dto.rulesetCode !== currentCode;
    const versionChanged = dtoVersion !== undefined && dtoVersion !== currentVersion;

    if (codeChanged || versionChanged) {
      // Switching ruleset wipes the existing config and seeds defaults from the
      // new ruleset. Caller-provided rulesetConfig in the same PATCH (rare) is
      // merged on top of the new defaults.
      const newDefaults = await resolveRulesetConfigDefaults(
        this.supabase,
        dto.rulesetCode ?? currentCode ?? 'TF_v1',
        dtoVersion ?? currentVersion ?? '1.0.0',
      );
      const callerPatch = dto.rulesetConfig ?? {};
      updates['ruleset_config'] = validateTournamentRulesetConfig(
        dto.rulesetCode ?? currentCode ?? 'TF_v1',
        deepMergeJson(newDefaults, callerPatch),
      );
    } else if (dto.rulesetConfig !== undefined) {
      // Same ruleset — merge caller patch onto the existing stored config.
      // We backfill from resolveRulesetConfigDefaults first so the strict
      // TFv1ConfigSchema.parse() in validateTournamentRulesetConfig doesn't
      // reject the merged result when the stored row is incomplete (legacy
      // data, or custom-ruleset tournaments whose seed produced only
      // matchFormat + doublePenaltyFormula). Precedence:
      //   defaults < stored < callerPatch
      const defaults = await resolveRulesetConfigDefaults(
        this.supabase,
        currentCode ?? 'TF_v1',
        currentVersion ?? '1.0.0',
      );
      const completedStored = deepMergeJson(defaults, currentJson['ruleset_config'] ?? {});
      const merged = deepMergeJson(completedStored, dto.rulesetConfig);
      updates['ruleset_config'] = validateTournamentRulesetConfig(currentCode ?? 'TF_v1', merged);
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

  async deleteTournament(tournamentId: string, userId: string) {
    const { data: row, error: fetchErr } = await this.supabase.service
      .from('tournaments')
      .select('event_id, status')
      .eq('id', tournamentId)
      .maybeSingle();
    if (fetchErr) throw new BadRequestException(fetchErr.message);
    if (!row) throw new NotFoundException(`Tournament ${tournamentId} not found`);

    const status = (row as { status: string }).status;
    if (['running', 'completed', 'archived'].includes(status)) {
      throw new ForbiddenException(
        'This tournament has progressed past the planning phase. Submit a deletion request.',
      );
    }

    // For draft/published: block if any match has results recorded.
    // matches → phases → tournaments (matches have phase_id, phases have tournament_id).
    const { data: scoredPhaseIds } = await this.supabase.service
      .from('phases')
      .select('id')
      .eq('tournament_id', tournamentId);
    const phaseIds = ((scoredPhaseIds ?? []) as Array<{ id: string }>).map((p) => p.id);
    if (phaseIds.length > 0) {
      const { count: scoredMatches } = await this.supabase.service
        .from('matches')
        .select('id', { count: 'exact', head: true })
        .in('phase_id', phaseIds)
        .neq('status', 'scheduled');
      if ((scoredMatches ?? 0) > 0) {
        throw new ForbiddenException(
          'This tournament has scored matches. Submit a deletion request.',
        );
      }
    }

    const event = await this.getEventById((row as { event_id: string }).event_id);
    await this.orgs.assertOrgRole(
      (event as { organization_id: string }).organization_id,
      userId,
      'admin',
    );
    const { error } = await this.supabase.service
      .from('tournaments')
      .delete()
      .eq('id', tournamentId);
    if (error) throw new BadRequestException(error.message);
    return { id: tournamentId };
  }

  async publishTournament(tournamentId: string, userId: string) {
    return this.setTournamentStatus(tournamentId, 'published', userId);
  }

  async unpublishTournament(tournamentId: string, userId: string) {
    return this.setTournamentStatus(tournamentId, 'draft', userId);
  }

  private async setTournamentStatus(tournamentId: string, status: string, userId: string) {
    const { data: row } = await this.supabase.service
      .from('tournaments')
      .select('event_id')
      .eq('id', tournamentId)
      .maybeSingle();
    if (!row) throw new NotFoundException(`Tournament ${tournamentId} not found`);
    const event = await this.getEventById((row as { event_id: string }).event_id);
    await this.orgs.assertOrgRole(
      (event as { organization_id: string }).organization_id,
      userId,
      'admin',
    );
    const { data, error } = await this.supabase.service
      .from('tournaments')
      .update({ status, updated_at: new Date().toISOString() })
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
      .select('id, organization_id, status, name, slug, start_date, end_date, location')
      .eq('id', eventId)
      .maybeSingle();

    if (error) throw new BadRequestException(error.message);
    if (!data) throw new NotFoundException(`Event ${eventId} not found`);
    return data;
  }
}
