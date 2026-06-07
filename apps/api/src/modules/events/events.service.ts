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
import { buildRoundCode } from '../matches/round-code.helper';
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

const EVENT_LOGO_BUCKET = 'event-assets';
const EVENT_LOGO_MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED_EVENT_LOGO_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

// Hero shares the bucket + MIME allowlist with logos; cap matches
// the logo limit so high-resolution camera JPEGs upload without a
// re-encode step.
const EVENT_HERO_MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED_EVENT_HERO_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

// Tournament statuses where the tournament IS publicly visible.
// When setTournamentStatus moves the tournament INTO one of these
// states, child phases get visibility_status='published'. When it
// moves OUT, child phases get visibility_status='hidden'. Keeps the
// phases row aligned with the tournament since operators have no
// per-phase visibility toggle anymore (see pools/page.tsx).
const TOURNAMENT_PUBLIC_STATUSES = new Set(['published', 'running', 'completed']);

export interface EventLogoUpload {
  buffer: Buffer;
  filename: string;
  mimetype: string;
}

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
    // Spectators poll this endpoint every ~30 s — bound the payload so a
    // 1000-event deploy doesn't ship 1000 rows per poll. Default + max =
    // 100. The cursor enables follow-on pagination by start_date when the
    // FE adds a "load more" affordance.
    const limit = Math.min(query.limit ?? 100, 100);

    let q = this.supabase.service
      .from('events')
      .select('*, organizations(name, slug, logo_url, brand_color)')
      .order('start_date', { ascending: false })
      .limit(limit);

    if (query.status && query.status !== 'all') q = q.eq('status', query.status) as typeof q;
    else q = q.in('status', ['published', 'running', 'completed']) as typeof q;

    if (query.organizationId) q = q.eq('organization_id', query.organizationId) as typeof q;

    if (query.cursor) q = q.lt('start_date', query.cursor) as typeof q;

    const { data, error } = await q;
    if (error) throw new BadRequestException(error.message);
    const rows = (data ?? []) as Array<Record<string, unknown>>;
    if (rows.length === 0) return rows;

    // Enrich with tournament_count so the public home page can show
    // 'N tournaments' per row without a per-event roundtrip. Also
    // collect each tournament's id so we can resolve the per-event
    // league list in one follow-up batch.
    const eventIds = rows.map((r) => r['id'] as string);
    const { data: tournRows, error: tournErr } = await this.supabase.service
      .from('tournaments')
      .select('id, event_id')
      .in('event_id', eventIds);
    if (tournErr) throw new BadRequestException(tournErr.message);
    const countByEvent = new Map<string, number>();
    const eventByTournament = new Map<string, string>();
    for (const t of (tournRows ?? []) as Array<{ id: string; event_id: string }>) {
      countByEvent.set(t.event_id, (countByEvent.get(t.event_id) ?? 0) + 1);
      eventByTournament.set(t.id, t.event_id);
    }

    // Project the linked-league list onto each event row so the public
    // Upcoming table can render a "League" cell without a per-event
    // roundtrip. Goes via league_tournament_links (status='approved')
    // → leagues. We dedupe per event so an event whose two tournaments
    // join the same league shows the league once.
    const tournamentIds = Array.from(eventByTournament.keys());
    const leaguesByEvent = new Map<
      string,
      Map<string, { id: string; name: string; slug: string }>
    >();
    if (tournamentIds.length > 0) {
      const { data: linkRows, error: linkErr } = await this.supabase.service
        .from('league_tournament_links')
        .select('tournament_id, leagues(id, name, slug)')
        .eq('status', 'approved')
        .in('tournament_id', tournamentIds);
      if (linkErr) throw new BadRequestException(linkErr.message);
      type LinkRow = {
        tournament_id: string;
        leagues:
          | { id: string; name: string; slug: string }
          | Array<{ id: string; name: string; slug: string }>
          | null;
      };
      for (const link of (linkRows ?? []) as LinkRow[]) {
        const eventId = eventByTournament.get(link.tournament_id);
        if (!eventId) continue;
        const embed = link.leagues;
        const league = Array.isArray(embed) ? embed[0] : embed;
        if (!league) continue;
        if (!leaguesByEvent.has(eventId)) leaguesByEvent.set(eventId, new Map());
        leaguesByEvent.get(eventId)!.set(league.id, league);
      }
    }

    return rows.map((row) => {
      const id = row['id'] as string;
      const leagueMap = leaguesByEvent.get(id);
      return {
        ...row,
        tournament_count: countByEvent.get(id) ?? 0,
        leagues: leagueMap ? Array.from(leagueMap.values()) : [],
      };
    });
  }

  async listOrgEvents(orgId: string, userId: string) {
    await this.orgs.assertOrgRole(orgId, userId, 'scorekeeper');
    const { data, error } = await this.supabase.service
      .from('events')
      .select('*, organizations(name, slug)')
      .eq('organization_id', orgId)
      .order('created_at', { ascending: false });
    if (error) throw new BadRequestException(error.message);
    const rows = (data ?? []) as Array<Record<string, unknown>>;
    if (rows.length === 0) return rows;

    // Enrich with creator display names + tournament counts.
    const creatorIds = Array.from(
      new Set(
        rows
          .map((row) => row['created_by_user_id'] as string | null)
          .filter((id): id is string => !!id),
      ),
    );
    const nameByUser = await this.resolveUserNames(creatorIds);

    const eventIds = rows.map((row) => row['id'] as string);
    const tournamentCountByEvent = new Map<string, number>();
    const tournamentToEvent = new Map<string, string>();
    if (eventIds.length > 0) {
      const { data: tournRows, error: tournErr } = await this.supabase.service
        .from('tournaments')
        .select('id, event_id')
        .in('event_id', eventIds);
      if (tournErr) throw new BadRequestException(tournErr.message);
      for (const t of (tournRows ?? []) as Array<{ id: string; event_id: string }>) {
        tournamentCountByEvent.set(t.event_id, (tournamentCountByEvent.get(t.event_id) ?? 0) + 1);
        if (t.id) tournamentToEvent.set(t.id, t.event_id);
      }
    }

    // Distinct-person count per event. Same person registered to two
    // tournaments in the same event counts once. Filtered to
    // registered/checked_in to match `assertCapacity` semantics — the
    // events list should reflect "people who'll actually show up",
    // not pending withdrawn rows.
    const tournamentIds = Array.from(tournamentToEvent.keys());
    const distinctPeopleByEvent = new Map<string, Set<string>>();
    if (tournamentIds.length > 0) {
      const { data: regRows, error: regErr } = await this.supabase.service
        .from('registrations')
        .select('tournament_id, person_id')
        .in('tournament_id', tournamentIds)
        .in('status', ['registered', 'checked_in']);
      if (regErr) throw new BadRequestException(regErr.message);
      for (const r of (regRows ?? []) as Array<{
        tournament_id: string;
        person_id: string | null;
      }>) {
        const evId = tournamentToEvent.get(r.tournament_id);
        if (!evId || !r.person_id) continue;
        const set = distinctPeopleByEvent.get(evId) ?? new Set<string>();
        set.add(r.person_id);
        distinctPeopleByEvent.set(evId, set);
      }
    }

    return rows.map((row) => {
      const creatorId = row['created_by_user_id'] as string | null;
      const evId = row['id'] as string;
      return {
        ...row,
        created_by_user_name: creatorId ? (nameByUser.get(creatorId) ?? null) : null,
        tournament_count: tournamentCountByEvent.get(evId) ?? 0,
        participant_count: distinctPeopleByEvent.get(evId)?.size ?? 0,
      };
    });
  }

  /**
   * Batch-resolve user_ids to display names. First-found wins across:
   *   1. global_persons (given_name + family_name) — covers organisers
   *      who self-claimed a fighter record.
   *   2. auth admin getUserById — covers org admins who created events
   *      but have no global_persons row. Reads user_metadata.display_name
   *      then falls back to email. This mirrors the precedent in
   *      admin-users.service.ts:normalizeDisplayName.
   * auth.users is GoTrue-only and not joinable from SQL, so the second
   * step is a per-id round-trip — kept narrow by only resolving ids that
   * step 1 missed.
   */
  private async resolveUserNames(userIds: string[]): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    if (userIds.length === 0) return map;
    const { data, error } = await this.supabase.service
      .from('global_persons')
      .select('claimed_by_user_id, given_name, family_name')
      .in('claimed_by_user_id', userIds);
    if (error) throw new BadRequestException(error.message);
    for (const row of (data ?? []) as Array<{
      claimed_by_user_id: string | null;
      given_name: string;
      family_name: string;
    }>) {
      const uid = row.claimed_by_user_id;
      if (!uid || map.has(uid)) continue;
      const name = `${row.given_name ?? ''} ${row.family_name ?? ''}`.trim();
      if (name) map.set(uid, name);
    }
    for (const uid of userIds) {
      if (map.has(uid)) continue;
      const name = await this.resolveAuthDisplayName(uid);
      if (name) map.set(uid, name);
    }
    return map;
  }

  private async resolveAuthDisplayName(userId: string): Promise<string | null> {
    try {
      const { data, error } = await this.supabase.service.auth.admin.getUserById(userId);
      if (error || !data?.user) return null;
      const meta = (data.user.user_metadata ?? {}) as Record<string, unknown>;
      const displayName =
        typeof meta['display_name'] === 'string' ? meta['display_name'].trim() : '';
      if (displayName) return displayName;
      return data.user.email ?? null;
    } catch {
      return null;
    }
  }

  async getEventBySlug(slug: string) {
    const query = this.supabase.service
      .from('events')
      .select('*, organizations(name, slug, logo_url, brand_color), themes(*), lices(*)');
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
        city: dto.city ?? null,
        country: dto.country ?? null,
        public_landing_md: dto.publicLandingMd ?? null,
        status: 'draft',
        created_by_user_id: userId,
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
    if (dto.city !== undefined) updates['city'] = dto.city;
    if (dto.country !== undefined) updates['country'] = dto.country;
    if (dto.startDate !== undefined) updates['start_date'] = dto.startDate;
    if (dto.endDate !== undefined) updates['end_date'] = dto.endDate;
    if (dto.publicLandingMd !== undefined) updates['public_landing_md'] = dto.publicLandingMd;
    if (dto.status !== undefined) updates['status'] = dto.status;
    if (dto.logoUrl !== undefined) updates['logo_url'] = dto.logoUrl;
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
      city?: string | null;
      country?: string | null;
      logo_url?: string | null;
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
    const waitlistByTournament = new Map<string, number>();
    for (const registration of registrations) {
      const status = registration.status ?? '';
      if (status === 'waitlist') {
        waitlistByTournament.set(
          registration.tournament_id,
          (waitlistByTournament.get(registration.tournament_id) ?? 0) + 1,
        );
        continue;
      }
      if (['withdrawn', 'disqualified'].includes(status)) continue;
      registrationsByTournament.set(
        registration.tournament_id,
        (registrationsByTournament.get(registration.tournament_id) ?? 0) + 1,
      );
    }

    // Null-aware sum: if every tournament is uncapped the total
    // stays null so the FE can drop the " / N" suffix.
    const sumNullable = (values: Array<number | null>): number | null => {
      const capped = values.filter((v): v is number => v != null);
      return capped.length === 0 ? null : capped.reduce((a, b) => a + b, 0);
    };
    const totalMaxParticipants = sumNullable(tournaments.map((t) => t.max_participants));
    const totalMaxWaitlist = sumNullable(tournaments.map((t) => t.max_waitlist));
    const totalWaitlistedFighters = Array.from(waitlistByTournament.values()).reduce(
      (a, b) => a + b,
      0,
    );

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
        city: event.city ?? null,
        country: event.country ?? null,
        logoUrl: event.logo_url ?? null,
      },
      totals: {
        tournaments: tournaments.length,
        registeredFighters: registrations.filter((registration) => {
          const status = registration.status ?? '';
          return !['withdrawn', 'disqualified', 'waitlist'].includes(status);
        }).length,
        waitlistedFighters: totalWaitlistedFighters,
        maxParticipants: totalMaxParticipants,
        maxWaitlist: totalMaxWaitlist,
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
          waitlistedCount: waitlistByTournament.get(tournament.id) ?? 0,
          maxParticipants: tournament.max_participants ?? null,
          maxWaitlist: tournament.max_waitlist ?? null,
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
      // 1. Globals per club. `global_persons` has no `email` column (was
      //    renamed from `fighters` in migration 0023, never gained one) —
      //    we pick up `claimed_by_user_id` instead so we can resolve email
      //    from `persons` below.
      const { data: globals, error: globalsErr } = await this.supabase.service
        .from('global_persons')
        .select('id, club_id, given_name, family_name, claimed_by_user_id')
        .in('club_id', clubIds);
      if (globalsErr) throw new BadRequestException(globalsErr.message);
      const rows = (globals ?? []) as Array<{
        id: string;
        club_id: string | null;
        given_name: string;
        family_name: string;
        claimed_by_user_id: string | null;
      }>;

      // 2. Resolve emails for claimed globals. Mirrors the resolveUsers
      //    pattern in review-queue.service.ts: persons.email + persons.
      //    claimed_by_user_id is the only SQL-accessible canonical email
      //    source (auth.users is GoTrue-only). First-found email wins per
      //    user (matches resolveUsers semantics — same cross-event trade-off).
      const claimedUserIds = Array.from(
        new Set(rows.map((g) => g.claimed_by_user_id).filter((id): id is string => !!id)),
      );
      const emailByUser = new Map<string, string>();
      if (claimedUserIds.length > 0) {
        const { data: emailRows, error: emailErr } = await this.supabase.service
          .from('persons')
          .select('claimed_by_user_id, email')
          .in('claimed_by_user_id', claimedUserIds);
        if (emailErr) throw new BadRequestException(emailErr.message);
        for (const row of (emailRows ?? []) as Array<{
          claimed_by_user_id: string | null;
          email: string | null;
        }>) {
          const uid = row.claimed_by_user_id;
          if (uid && row.email && !emailByUser.has(uid)) emailByUser.set(uid, row.email);
        }
      }

      // 3. Build per-club globals with email resolved per user.
      for (const g of rows) {
        if (!g.club_id) continue;
        const arr = globalsByClub.get(g.club_id) ?? [];
        arr.push({
          id: g.id,
          given_name: g.given_name,
          family_name: g.family_name,
          email: g.claimed_by_user_id ? (emailByUser.get(g.claimed_by_user_id) ?? null) : null,
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
      .select('id, name, weapon, ruleset_code, status, logo_url, color')
      .eq('event_id', eventId)
      .eq('slug', tournamentSlug)
      .maybeSingle();
    if (tournamentError) throw new BadRequestException(tournamentError.message);
    if (!tournament) throw new NotFoundException(`Tournament ${tournamentSlug} not found`);

    // Tournament status is the canonical public gate. When the
    // tournament hasn't been published yet, the public page shows
    // nothing structural even if phases happen to exist. Once
    // published / running / completed, every phase is visible —
    // operators don't actually stage pool→bracket reveals per phase,
    // so layering phase-visibility on top was a UX trap (operator
    // publishes the tournament, public sees nothing, no clue why).
    const tournamentStatus = (tournament as { status: string }).status;
    const publicTournamentStatuses = ['published', 'running', 'completed'];
    const tournamentHeader = {
      id: tournament['id'],
      name: tournament['name'],
      weapon: tournament['weapon'],
      rulesetCode: tournament['ruleset_code'],
      status: tournament['status'],
      logoUrl: (tournament['logo_url'] as string | null) ?? null,
      // Optional brand color token (e.g. 'red', 'blue'). The public
      // page threads this through tab underlines, card outlines, and
      // section titles via @myclash/ui's color-token helpers.
      color: (tournament['color'] as string | null) ?? null,
    };
    if (!publicTournamentStatuses.includes(tournamentStatus)) {
      return {
        tournament: tournamentHeader,
        pools: [],
        bracketSlots: [],
        bracketSize: 0,
        bracketRounds: 0,
      };
    }

    const { data: phases, error: phasesError } = await this.supabase.service
      .from('phases')
      .select('id, type, visibility_status, config_json')
      .eq('tournament_id', (tournament as { id: string }).id);
    if (phasesError) throw new BadRequestException(phasesError.message);

    const phaseRows = (phases ?? []) as Array<Record<string, unknown>>;
    const poolPhase = phaseRows.find((phase) => phase['type'] === 'pool');
    const bracketPhase = phaseRows.find((phase) => phase['type'] === 'single_elim');

    const pools =
      poolPhase && typeof poolPhase['id'] === 'string'
        ? await this.getPublishedPools(poolPhase['id'], eventId)
        : [];
    const bracket =
      bracketPhase && typeof bracketPhase['id'] === 'string'
        ? await this.getPublishedBracket(bracketPhase)
        : { bracketSlots: [], bracketSize: 0, bracketRounds: 0 };

    return {
      tournament: tournamentHeader,
      pools,
      ...bracket,
    };
  }

  /**
   * Public pools-with-matches projection for the spectator page. One
   * entry per pool with the read-only match list (no admin pickers,
   * no referee chips — referees still surface on the Pool List card
   * footer). Gates on tournament status === published / running /
   * completed; returns 404 otherwise (consistent with the standings
   * endpoint above).
   *
   * Match projection mirrors what the admin's MatchesTab shows minus
   * the per-match referee column: round code, fighter names + club
   * abbreviations, score, status, lice name + color.
   */
  async getPublicTournamentPoolsWithMatches(eventSlug: string, tournamentSlug: string) {
    const event = await this.getEventBySlug(eventSlug);
    const eventId = (event as { id: string }).id;

    const { data: tournament, error: tournamentError } = await this.supabase.service
      .from('tournaments')
      .select('id, weapon, status')
      .eq('event_id', eventId)
      .eq('slug', tournamentSlug)
      .maybeSingle();
    if (tournamentError) throw new BadRequestException(tournamentError.message);
    if (!tournament) throw new NotFoundException(`Tournament ${tournamentSlug} not found`);
    const tournamentStatus = (tournament as { status: string }).status;
    if (!['published', 'running', 'completed'].includes(tournamentStatus)) {
      return { tournamentId: (tournament as { id: string }).id, pools: [] };
    }
    const tournamentId = (tournament as { id: string }).id;
    const weapon = (tournament as { weapon: string | null }).weapon ?? null;

    // 1. Pool phase.
    const { data: phaseRow } = await this.supabase.service
      .from('phases')
      .select('id, config_json')
      .eq('tournament_id', tournamentId)
      .eq('type', 'pool')
      .maybeSingle();
    if (!phaseRow) return { tournamentId, pools: [] };
    const phaseId = (phaseRow as { id: string }).id;

    // 2. Pools (id + name + sort_order so we can compute the canonical
    //    pool number `P{sort_order + 1}` for the round code).
    const { data: poolsData } = await this.supabase.service
      .from('pools')
      .select('id, name, sort_order')
      .eq('phase_id', phaseId)
      .order('sort_order', { ascending: true });
    const pools = (poolsData ?? []) as Array<{
      id: string;
      name: string;
      sort_order: number | null;
    }>;
    if (pools.length === 0) return { tournamentId, pools: [] };

    const poolIds = pools.map((p) => p.id);

    // 3. Matches for these pools. Nested joins resolve fighter names
    //    via registrations → persons → clubs and the lice row for
    //    color + name. Status / scores come straight off the matches
    //    table.
    const { data: matchesData, error: matchesError } = await this.supabase.service
      .from('matches')
      .select(
        'id, status, scheduled_at, match_number_label, red_score, blue_score, pool_id, lice_id, ' +
          'red:registrations!matches_red_registration_id_fkey(id, persons(given_name, family_name, clubs(abbreviation))), ' +
          'blue:registrations!matches_blue_registration_id_fkey(id, persons(given_name, family_name, clubs(abbreviation))), ' +
          'lices(id, name, color_hex)',
      )
      .in('pool_id', poolIds)
      .order('pool_id', { ascending: true })
      .order('match_number_label', { ascending: true });
    if (matchesError) throw new BadRequestException(matchesError.message);

    type PersonClubEmbed = {
      given_name: string | null;
      family_name: string | null;
      clubs: { abbreviation: string | null } | null;
    } | null;
    type SideRel = { id: string; persons: PersonClubEmbed } | null;
    type LiceRel = { id: string; name: string | null; color_hex: string | null } | null;
    const matchRows = (matchesData ?? []) as unknown as Array<{
      id: string;
      status: string | null;
      scheduled_at: string | null;
      match_number_label: string | null;
      red_score: number | null;
      blue_score: number | null;
      pool_id: string | null;
      lice_id: string | null;
      red: SideRel;
      blue: SideRel;
      lices: LiceRel;
    }>;

    function nameFrom(side: SideRel): string | null {
      if (!side?.persons) return null;
      const given = side.persons.given_name?.trim() ?? '';
      const family = side.persons.family_name?.trim() ?? '';
      const composed = `${given} ${family}`.trim();
      return composed || null;
    }
    function clubAbbrevFrom(side: SideRel): string | null {
      return side?.persons?.clubs?.abbreviation ?? null;
    }

    // 4. Group matches by pool + project. Round code uses the same
    //    helper the admin matches list uses, so the public + admin
    //    surfaces ship matching identifiers.
    const matchesByPool = new Map<string, typeof matchRows>();
    for (const m of matchRows) {
      if (!m.pool_id) continue;
      const list = matchesByPool.get(m.pool_id) ?? [];
      list.push(m);
      matchesByPool.set(m.pool_id, list);
    }

    return {
      tournamentId,
      pools: pools.map((pool) => {
        const poolNumber = typeof pool.sort_order === 'number' ? pool.sort_order + 1 : null;
        const rows = matchesByPool.get(pool.id) ?? [];
        return {
          poolId: pool.id,
          poolName: pool.name,
          matches: rows.map((m) => ({
            matchId: m.id,
            roundCode: buildRoundCode({
              weapon,
              poolNumber,
              bracketRound: null,
              bracketSize: null,
              matchNumberLabel: m.match_number_label,
              roundNumber: null,
            }),
            status: m.status ?? 'scheduled',
            scheduledAt: m.scheduled_at,
            redFighterName: nameFrom(m.red),
            redClubAbbrev: clubAbbrevFrom(m.red),
            redScore: m.red_score,
            blueFighterName: nameFrom(m.blue),
            blueClubAbbrev: clubAbbrevFrom(m.blue),
            blueScore: m.blue_score,
            liceName: m.lices?.name ?? null,
            liceColorHex: m.lices?.color_hex ?? null,
          })),
        };
      }),
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
    const tournaments = (data ?? []) as Array<Record<string, unknown>>;
    if (tournaments.length === 0) return [];

    // Decorate each row with `registered`: the count of registrations
    // whose status is 'registered' or 'checked_in' — matches the
    // capacity-guard semantics in registrations.service.assertCapacity.
    // One grouped fetch keeps this O(1) round-trips regardless of how
    // many tournaments the event has.
    const tournamentIds = tournaments
      .map((t) => (t['id'] as string | undefined) ?? null)
      .filter((id): id is string => Boolean(id));

    const { data: regRows } = await this.supabase.service
      .from('registrations')
      .select('tournament_id, status')
      .in('tournament_id', tournamentIds)
      .in('status', ['registered', 'checked_in']);

    const counts = new Map<string, number>();
    for (const row of (regRows ?? []) as Array<{ tournament_id: string }>) {
      counts.set(row.tournament_id, (counts.get(row.tournament_id) ?? 0) + 1);
    }

    return tournaments.map((t) => ({
      ...t,
      registered: counts.get((t['id'] as string) ?? '') ?? 0,
    }));
  }

  /**
   * Slice 3a of the public microsite overhaul: every person registered
   * to a tournament on this event, grouped into one row per person
   * with the tournaments they're entered in. Public — no auth.
   *
   * Excludes withdrawn / disqualified registrations; everyone else is
   * surfaced. The `registrationState` field is forward-looking; the
   * current schema has no waitlist status, so every projected entry
   * reports 'active'. When a waitlist column lands the projection
   * can switch without changing the public payload shape.
   */
  async listPublicParticipants(slugOrId: string): Promise<
    Array<{
      personId: string;
      displayName: string;
      clubName: string | null;
      clubAbbrev: string | null;
      tournaments: Array<{
        id: string;
        slug: string;
        name: string;
        color: string | null;
        registrationState: 'active';
      }>;
    }>
  > {
    const event = await this.getEventBySlug(slugOrId);
    const eventId = (event as { id: string }).id;

    const { data: tournamentRows, error: tournErr } = await this.supabase.service
      .from('tournaments')
      .select('id, slug, name, color')
      .eq('event_id', eventId);
    if (tournErr) throw new BadRequestException(tournErr.message);
    const tournaments = (tournamentRows ?? []) as Array<{
      id: string;
      slug: string;
      name: string;
      color: string | null;
    }>;
    if (tournaments.length === 0) return [];
    const tournamentById = new Map(tournaments.map((t) => [t.id, t]));

    const { data: regRows, error: regErr } = await this.supabase.service
      .from('registrations')
      .select('tournament_id, person_id, status')
      .in(
        'tournament_id',
        tournaments.map((t) => t.id),
      )
      .in('status', ['registered', 'checked_in']);
    if (regErr) throw new BadRequestException(regErr.message);
    const registrations = (regRows ?? []) as Array<{
      tournament_id: string;
      person_id: string;
      status: string;
    }>;
    if (registrations.length === 0) return [];

    const personIds = Array.from(new Set(registrations.map((r) => r.person_id)));
    const { data: personRows, error: personErr } = await this.supabase.service
      .from('persons')
      .select('id, given_name, family_name, club_id')
      .in('id', personIds);
    if (personErr) throw new BadRequestException(personErr.message);
    const persons = (personRows ?? []) as Array<{
      id: string;
      given_name: string;
      family_name: string;
      club_id: string | null;
    }>;
    const personById = new Map(persons.map((p) => [p.id, p]));

    const clubIds = Array.from(
      new Set(persons.map((p) => p.club_id).filter((id): id is string => !!id)),
    );
    const clubById = new Map<string, { name: string; abbreviation: string | null }>();
    if (clubIds.length > 0) {
      const { data: clubRows, error: clubErr } = await this.supabase.service
        .from('clubs')
        .select('id, name, abbreviation')
        .in('id', clubIds);
      if (clubErr) throw new BadRequestException(clubErr.message);
      for (const c of (clubRows ?? []) as Array<{
        id: string;
        name: string;
        abbreviation: string | null;
      }>) {
        clubById.set(c.id, { name: c.name, abbreviation: c.abbreviation });
      }
    }

    const byPerson = new Map<
      string,
      {
        personId: string;
        displayName: string;
        clubName: string | null;
        clubAbbrev: string | null;
        tournaments: Array<{
          id: string;
          slug: string;
          name: string;
          color: string | null;
          registrationState: 'active';
        }>;
      }
    >();
    for (const reg of registrations) {
      const person = personById.get(reg.person_id);
      if (!person) continue;
      const tournament = tournamentById.get(reg.tournament_id);
      if (!tournament) continue;
      let row = byPerson.get(reg.person_id);
      if (!row) {
        const club = person.club_id ? (clubById.get(person.club_id) ?? null) : null;
        row = {
          personId: person.id,
          displayName: `${person.given_name} ${person.family_name}`.trim() || person.id,
          clubName: club?.name ?? null,
          clubAbbrev: club?.abbreviation ?? null,
          tournaments: [],
        };
        byPerson.set(reg.person_id, row);
      }
      row.tournaments.push({
        id: tournament.id,
        slug: tournament.slug,
        name: tournament.name,
        color: tournament.color,
        registrationState: 'active',
      });
    }

    return Array.from(byPerson.values()).sort((a, b) => a.displayName.localeCompare(b.displayName));
  }

  private async getEventTournaments(eventId: string) {
    const { data, error } = await this.supabase.service
      .from('tournaments')
      .select('id, slug, name, status, color, ruleset_code, max_participants, max_waitlist')
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
      max_participants: number | null;
      max_waitlist: number | null;
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
      .select('person_id, pool_id, match_id')
      .eq('event_id', eventId);
    if (assignmentsError) throw new BadRequestException(assignmentsError.message);

    const personsByTournament = new Map<string, Set<string>>();
    for (const assignment of (assignments ?? []) as Array<{
      person_id: string;
      pool_id: string | null;
      match_id: string | null;
    }>) {
      const tournamentId =
        (assignment.pool_id ? poolToTournament.get(assignment.pool_id) : undefined) ??
        (assignment.match_id ? matchToTournament.get(assignment.match_id) : undefined);
      if (!tournamentId) continue;
      const persons = personsByTournament.get(tournamentId) ?? new Set<string>();
      persons.add(assignment.person_id);
      personsByTournament.set(tournamentId, persons);
    }

    for (const [tournamentId, persons] of personsByTournament) {
      counts.set(tournamentId, persons.size);
    }
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

  private async getPublishedPools(phaseId: string, eventId: string) {
    // 1. Pools + members (joined via pool_members → registrations → persons → clubs).
    const { data, error } = await this.supabase.service
      .from('pools')
      .select(
        'id, name, pool_members(registration_id, seed, registrations(id, persons(id, given_name, family_name, clubs(id, name, abbreviation))))',
      )
      .eq('phase_id', phaseId)
      .order('sort_order', { ascending: true });
    if (error) throw new BadRequestException(error.message);

    // Supabase types nested joins as arrays even when the FK is one-to-one;
    // the pool-standings service uses the same `as unknown as` shape cast.
    const poolRows = (data ?? []) as unknown as Array<{
      id: string;
      name: string;
      pool_members: Array<{
        registration_id: string;
        seed: number | null;
        registrations: {
          id: string;
          persons: {
            id: string;
            given_name: string | null;
            family_name: string | null;
            clubs: { id: string; name: string; abbreviation: string | null } | null;
          } | null;
        } | null;
      }> | null;
    }>;

    const poolIds = poolRows.map((p) => p.id);

    // 2. Referee assignments for these pools — projected as a public-safe
    //    shape (display name + role + status; never auto_assigned or
    //    conflicts_jsonb). The display name comes from the auth.users (if
    //    claimed) or global_persons (if person-scoped) table.
    const refereesByPool = await this.getPublishedRefereesByPool(eventId, poolIds);

    // 3. Compose the public payload. `standings` stays empty here —
    //    the public tournament page hydrates per-pool standings via
    //    Realtime / a dedicated endpoint.
    return poolRows.map((pool) => ({
      id: pool.id,
      name: pool.name,
      members: (pool.pool_members ?? [])
        .map((m) => {
          const person = m.registrations?.persons;
          const given = person?.given_name?.trim() ?? '';
          const family = person?.family_name?.trim() ?? '';
          const fighterName = `${given} ${family}`.trim() || '—';
          return {
            registrationId: m.registration_id,
            fighterName,
            clubName: person?.clubs?.name ?? null,
            clubAbbreviation: person?.clubs?.abbreviation ?? null,
            seed: m.seed ?? null,
          };
        })
        .sort((a, b) => {
          // Members sorted by seed (lowest first), with unseeded last.
          const aSeed = a.seed ?? Number.POSITIVE_INFINITY;
          const bSeed = b.seed ?? Number.POSITIVE_INFINITY;
          return aSeed - bSeed;
        }),
      referees: refereesByPool.get(pool.id) ?? [],
      standings: [],
    }));
  }

  /**
   * For each pool, return the confirmed + pending referee slots projected
   * for public consumption. Never exposes auto_assigned / conflicts_jsonb /
   * candidate suggestions — those are admin-only signals.
   */
  private async getPublishedRefereesByPool(
    eventId: string,
    poolIds: string[],
  ): Promise<
    Map<
      string,
      Array<{
        role: string | null;
        displayName: string;
        status: string;
        skillColor: string;
      }>
    >
  > {
    const byPool = new Map<
      string,
      Array<{ role: string | null; displayName: string; status: string; skillColor: string }>
    >();
    if (poolIds.length === 0) return byPool;

    const { data: assignments, error } = await this.supabase.service
      .from('referee_assignments')
      .select('pool_id, role, status, person_id')
      .eq('event_id', eventId)
      .eq('scope_type', 'pool')
      .in('pool_id', poolIds)
      .in('status', ['assigned', 'confirmed', 'pending']);
    if (error) throw new BadRequestException(error.message);

    const rows = (assignments ?? []) as Array<{
      pool_id: string | null;
      role: string | null;
      status: string;
      person_id: string | null;
    }>;
    if (rows.length === 0) return byPool;

    // Resolve display names via global_persons (given+family). Post-0063
    // `referee_assignments.person_id` is NOT NULL, so every row resolves
    // through this single lookup — no Supabase-user-id fallback.
    const personIds = Array.from(
      new Set(rows.map((r) => r.person_id).filter((id): id is string => !!id)),
    );

    const personNameById = new Map<string, string>();
    if (personIds.length > 0) {
      const { data: personRows } = await this.supabase.service
        .from('global_persons')
        .select('id, given_name, family_name')
        .in('id', personIds);
      for (const p of (personRows ?? []) as Array<{
        id: string;
        given_name: string | null;
        family_name: string | null;
      }>) {
        const name = `${(p.given_name ?? '').trim()} ${(p.family_name ?? '').trim()}`.trim();
        if (name) personNameById.set(p.id, name);
      }
    }

    // Resolve skill colors. `referee_assignments.role` carries the
    // `referee_skills.id` string (e.g. 'arbitre_assesseur'); the
    // skill table holds the colour token used to tint the chip on
    // the public Pool List footer.
    const skillIds = Array.from(new Set(rows.map((r) => r.role).filter((r): r is string => !!r)));
    const skillColorById = new Map<string, string>();
    if (skillIds.length > 0) {
      const { data: skillRows } = await this.supabase.service
        .from('referee_skills')
        .select('id, color')
        .in('id', skillIds);
      for (const s of (skillRows ?? []) as Array<{ id: string; color: string | null }>) {
        if (s.color) skillColorById.set(s.id, s.color);
      }
    }

    for (const r of rows) {
      if (!r.pool_id) continue;
      const displayName = r.person_id ? (personNameById.get(r.person_id) ?? '—') : '—';
      const skillColor = r.role ? (skillColorById.get(r.role) ?? 'slate') : 'slate';
      const list = byPool.get(r.pool_id) ?? [];
      list.push({ role: r.role, displayName, status: r.status, skillColor });
      byPool.set(r.pool_id, list);
    }
    return byPool;
  }

  private async getPublishedBracket(phase: Record<string, unknown>) {
    const phaseId = phase['id'] as string;
    const { data, error } = await this.supabase.service
      .from('bracket_slots')
      .select('id, round, position, registration_a_id, registration_b_id')
      .eq('phase_id', phaseId)
      .order('round', { ascending: true });
    if (error) throw new BadRequestException(error.message);

    type RawSlot = {
      id: string;
      round: number;
      position: number;
      registration_a_id: string | null;
      registration_b_id: string | null;
    };
    const rawSlots = (data ?? []) as RawSlot[];
    const slotIds = rawSlots.map((s) => s.id);

    // Enrich slots with the same shape the admin's BracketView consumes —
    // matches keyed by bracket_slot_id (status + scores + matchId), and
    // registrations referenced by either side (with persons + clubs
    // embeds for the fighter name + club abbreviation).
    const matchBySlot = new Map<
      string,
      {
        id: string;
        status: string;
        red_score: number | null;
        blue_score: number | null;
        match_number_label: string | null;
      }
    >();
    if (slotIds.length > 0) {
      const { data: matchRows } = await this.supabase.service
        .from('matches')
        .select('id, bracket_slot_id, status, red_score, blue_score, match_number_label')
        .in('bracket_slot_id', slotIds);
      for (const m of (matchRows ?? []) as Array<{
        id: string;
        bracket_slot_id: string;
        status: string;
        red_score: number | null;
        blue_score: number | null;
        match_number_label: string | null;
      }>) {
        matchBySlot.set(m.bracket_slot_id, {
          id: m.id,
          status: m.status,
          red_score: m.red_score,
          blue_score: m.blue_score,
          match_number_label: m.match_number_label,
        });
      }
    }

    type EmbeddedPerson = {
      given_name: string | null;
      family_name: string | null;
      clubs: { name: string | null; abbreviation: string | null } | null;
    };
    const regIds = Array.from(
      new Set(
        rawSlots
          .flatMap((s) => [s.registration_a_id, s.registration_b_id])
          .filter((v): v is string => Boolean(v)),
      ),
    );
    const regById = new Map<string, { fighterName: string | null; clubAbbrev: string | null }>();
    if (regIds.length > 0) {
      const { data: regRows } = await this.supabase.service
        .from('registrations')
        .select('id, persons(given_name, family_name, clubs(name, abbreviation))')
        .in('id', regIds);
      for (const r of (regRows ?? []) as unknown as Array<{
        id: string;
        persons: EmbeddedPerson | null;
      }>) {
        const person = r.persons;
        const club = person?.clubs ?? null;
        const name = `${person?.given_name ?? ''} ${person?.family_name ?? ''}`.trim();
        regById.set(r.id, {
          fighterName: name || null,
          clubAbbrev: club?.abbreviation ?? club?.name ?? null,
        });
      }
    }

    const enrichedSlots = rawSlots.map((s) => {
      const match = matchBySlot.get(s.id) ?? null;
      const red = s.registration_a_id ? (regById.get(s.registration_a_id) ?? null) : null;
      const blue = s.registration_b_id ? (regById.get(s.registration_b_id) ?? null) : null;
      return {
        id: s.id,
        round: s.round,
        position: s.position,
        redFighterName: red?.fighterName ?? null,
        blueFighterName: blue?.fighterName ?? null,
        redClubAbbrev: red?.clubAbbrev ?? null,
        blueClubAbbrev: blue?.clubAbbrev ?? null,
        redScore: match?.red_score ?? null,
        blueScore: match?.blue_score ?? null,
        status: match?.status ?? 'scheduled',
        matchId: match?.id ?? null,
        redRegistrationId: s.registration_a_id,
        blueRegistrationId: s.registration_b_id,
      };
    });

    const config = (phase['config_json'] ?? {}) as Record<string, unknown>;
    return {
      bracketSlots: enrichedSlots,
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
        // Capacity caps from the wizard's Step 1 Basics. Null
        // (or omitted) = no cap, same semantics as the settings
        // page's UpdateTournamentDto path.
        max_participants: dto.maxParticipants ?? null,
        max_waitlist: dto.maxWaitlist ?? null,
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
    if (dto.logoUrl !== undefined) updates['logo_url'] = dto.logoUrl;
    // Slice 4: capacity caps. null clears the cap; operator leaves blank
    // for no limit, fills in for a hard ceiling.
    if (dto.maxParticipants !== undefined) updates['max_participants'] = dto.maxParticipants;
    if (dto.maxWaitlist !== undefined) updates['max_waitlist'] = dto.maxWaitlist;

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
    const now = new Date().toISOString();
    const { data, error } = await this.supabase.service
      .from('tournaments')
      .update({ status, updated_at: now })
      .eq('id', tournamentId)
      .select('*')
      .single();
    if (error) throw new BadRequestException(error.message);

    // Cascade visibility to every child phase. The operator has no
    // per-phase visibility toggle anymore (pools/page.tsx removed
    // it; tournament status is the canonical public gate), so the
    // phases row must follow the tournament. Public statuses
    // publish; draft/archived hide. Stamps published_at +
    // published_by_user_id on publish; on hide we leave them as
    // historical record of the last publish.
    const phaseVisibility = TOURNAMENT_PUBLIC_STATUSES.has(status) ? 'published' : 'hidden';
    const phasePatch: Record<string, unknown> = { visibility_status: phaseVisibility };
    if (phaseVisibility === 'published') {
      phasePatch['published_at'] = now;
      phasePatch['published_by_user_id'] = userId;
    }
    await this.supabase.service.from('phases').update(phasePatch).eq('tournament_id', tournamentId);

    return data;
  }

  async uploadLogo(
    eventId: string,
    userId: string,
    file: EventLogoUpload,
  ): Promise<{ url: string }> {
    const event = await this.getEventById(eventId);
    await this.orgs.assertOrgRole(
      (event as { organization_id: string }).organization_id,
      userId,
      'admin',
    );

    if (!file.buffer.length) throw new BadRequestException('No logo file uploaded.');
    if (file.buffer.length > EVENT_LOGO_MAX_BYTES) {
      throw new BadRequestException('Logo upload exceeds the 10 MB size limit.');
    }
    if (!ALLOWED_EVENT_LOGO_MIME_TYPES.has(file.mimetype)) {
      throw new BadRequestException('Logo upload must be a PNG, JPEG, or WebP image.');
    }

    await this.ensureLogoBucket();
    const extension =
      file.mimetype === 'image/png' ? 'png' : file.mimetype === 'image/webp' ? 'webp' : 'jpg';
    const safeBase = file.filename
      .toLowerCase()
      .replace(/\.[^.]+$/u, '')
      .replace(/[^a-z0-9-]+/gu, '-')
      .replace(/^-+|-+$/gu, '')
      .slice(0, 60);
    const path = `events/${eventId}/logo-${Date.now()}-${safeBase || 'image'}.${extension}`;

    const { error } = await this.supabase.service.storage
      .from(EVENT_LOGO_BUCKET)
      .upload(path, file.buffer, { contentType: file.mimetype, upsert: true });
    if (error) throw new BadRequestException(error.message);

    const { data } = this.supabase.service.storage.from(EVENT_LOGO_BUCKET).getPublicUrl(path);
    const url = data.publicUrl;

    const { error: updateError } = await this.supabase.service
      .from('events')
      .update({ logo_url: url, updated_at: new Date().toISOString() })
      .eq('id', eventId);
    if (updateError) throw new BadRequestException(updateError.message);

    return { url };
  }

  /**
   * Upload a per-event hero image. Mirrors `uploadLogo` but the
   * destination column is `themes.hero_image_url` (not
   * `events.hero_image_url` — that column was dropped in migration
   * 0086 as part of the public-redesign theme scope-down).
   *
   * Storage path uses a `hero-` prefix so it sits next to the
   * event's logo under the same `events/<id>/` folder without
   * clobbering it.
   */
  async uploadHero(
    eventId: string,
    userId: string,
    file: EventLogoUpload,
  ): Promise<{ url: string }> {
    const event = await this.getEventById(eventId);
    await this.orgs.assertOrgRole(
      (event as { organization_id: string }).organization_id,
      userId,
      'admin',
    );

    if (!file.buffer.length) throw new BadRequestException('No hero file uploaded.');
    if (file.buffer.length > EVENT_HERO_MAX_BYTES) {
      throw new BadRequestException('Hero upload exceeds the 10 MB size limit.');
    }
    if (!ALLOWED_EVENT_HERO_MIME_TYPES.has(file.mimetype)) {
      throw new BadRequestException('Hero upload must be a PNG, JPEG, or WebP image.');
    }

    await this.ensureLogoBucket();
    const extension =
      file.mimetype === 'image/png' ? 'png' : file.mimetype === 'image/webp' ? 'webp' : 'jpg';
    const safeBase = file.filename
      .toLowerCase()
      .replace(/\.[^.]+$/u, '')
      .replace(/[^a-z0-9-]+/gu, '-')
      .replace(/^-+|-+$/gu, '')
      .slice(0, 60);
    const path = `events/${eventId}/hero-${Date.now()}-${safeBase || 'image'}.${extension}`;

    const { error } = await this.supabase.service.storage
      .from(EVENT_LOGO_BUCKET)
      .upload(path, file.buffer, { contentType: file.mimetype, upsert: true });
    if (error) throw new BadRequestException(error.message);

    const { data } = this.supabase.service.storage.from(EVENT_LOGO_BUCKET).getPublicUrl(path);
    const url = data.publicUrl;

    // Upsert themes.hero_image_url. The themes row may or may not
    // exist for a freshly-created event; mirror the existing-row
    // check pattern from EventThemesService.upsertTheme so we
    // INSERT on first save and UPDATE thereafter.
    const { data: existing } = await this.supabase.service
      .from('themes')
      .select('id')
      .eq('event_id', eventId)
      .maybeSingle();

    if (existing) {
      const { error: updateError } = await this.supabase.service
        .from('themes')
        .update({ hero_image_url: url })
        .eq('id', (existing as { id: string }).id);
      if (updateError) throw new BadRequestException(updateError.message);
    } else {
      const { error: insertError } = await this.supabase.service
        .from('themes')
        .insert({ event_id: eventId, hero_image_url: url });
      if (insertError) throw new BadRequestException(insertError.message);
    }

    return { url };
  }

  private async ensureLogoBucket(): Promise<void> {
    const storage = this.supabase.service.storage;
    const { data, error } = await storage.getBucket(EVENT_LOGO_BUCKET);
    if (data && !error) return;
    const created = await storage.createBucket(EVENT_LOGO_BUCKET, {
      public: true,
      fileSizeLimit: EVENT_LOGO_MAX_BYTES,
      allowedMimeTypes: Array.from(ALLOWED_EVENT_LOGO_MIME_TYPES),
    });
    if (created.error && !/already exists/iu.test(created.error.message)) {
      throw new BadRequestException(created.error.message);
    }
  }

  /**
   * Upload a per-tournament logo. Mirrors `uploadLogo` for events: same
   * 10 MB cap, PNG/JPEG/WebP only, shared `event-assets` bucket. Storage
   * path is `tournaments/{tournamentId}/logo-{ts}-{safeBase}.{ext}` so
   * each upload bypasses the public CDN cache, and we write the URL back
   * to `tournaments.logo_url` directly (no separate themes table —
   * matches the org pattern).
   */
  async uploadTournamentLogo(
    tournamentId: string,
    userId: string,
    file: EventLogoUpload,
  ): Promise<{ url: string }> {
    const { data: row, error: readError } = await this.supabase.service
      .from('tournaments')
      .select('event_id')
      .eq('id', tournamentId)
      .maybeSingle();
    if (readError) throw new BadRequestException(readError.message);
    if (!row) throw new NotFoundException(`Tournament ${tournamentId} not found`);

    const event = await this.getEventById((row as { event_id: string }).event_id);
    await this.orgs.assertOrgRole(
      (event as { organization_id: string }).organization_id,
      userId,
      'admin',
    );

    if (!file.buffer.length) throw new BadRequestException('No logo file uploaded.');
    if (file.buffer.length > EVENT_LOGO_MAX_BYTES) {
      throw new BadRequestException('Logo upload exceeds the 10 MB size limit.');
    }
    if (!ALLOWED_EVENT_LOGO_MIME_TYPES.has(file.mimetype)) {
      throw new BadRequestException('Logo upload must be a PNG, JPEG, or WebP image.');
    }

    await this.ensureLogoBucket();
    const extension =
      file.mimetype === 'image/png' ? 'png' : file.mimetype === 'image/webp' ? 'webp' : 'jpg';
    const safeBase = file.filename
      .toLowerCase()
      .replace(/\.[^.]+$/u, '')
      .replace(/[^a-z0-9-]+/gu, '-')
      .replace(/^-+|-+$/gu, '')
      .slice(0, 60);
    const path = `tournaments/${tournamentId}/logo-${Date.now()}-${safeBase || 'image'}.${extension}`;

    const { error: uploadError } = await this.supabase.service.storage
      .from(EVENT_LOGO_BUCKET)
      .upload(path, file.buffer, { contentType: file.mimetype, upsert: true });
    if (uploadError) throw new BadRequestException(uploadError.message);

    const { data } = this.supabase.service.storage.from(EVENT_LOGO_BUCKET).getPublicUrl(path);
    const url = data.publicUrl;

    const { error: updateError } = await this.supabase.service
      .from('tournaments')
      .update({ logo_url: url, updated_at: new Date().toISOString() })
      .eq('id', tournamentId);
    if (updateError) throw new BadRequestException(updateError.message);

    return { url };
  }

  // ── Private helpers ──────────────────────────────────────────────────────────

  private async getEventById(eventId: string) {
    const { data, error } = await this.supabase.service
      .from('events')
      .select(
        'id, organization_id, status, name, slug, start_date, end_date, city, country, logo_url, created_by_user_id',
      )
      .eq('id', eventId)
      .maybeSingle();

    if (error) throw new BadRequestException(error.message);
    if (!data) throw new NotFoundException(`Event ${eventId} not found`);
    return data;
  }
}
