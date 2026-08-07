import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import {
  allowsDirectHardDelete,
  asEventKind,
  countsTowardStats,
  DEFAULT_EVENT_KIND,
  isPubliclyVisible,
} from '@myclash/types';
import { SupabaseService } from '../supabase/supabase.service';
import { insertAuditLog } from '../../common/audit-log';
import { hasPlatformTier } from '../../common/auth/platform-role';
import { HemaRatingsService } from '../hema-ratings/hema-ratings.service';
import { normalizePersonName, type WeaponRating } from '../hema-ratings/weapon-rating';
import { resolveCatalogWeapon } from '../fighters/weapon-catalog.util';
import { OrganizationsService } from '../organizations/organizations.service';
import { NotificationEventsService } from '../notifications/event-handlers/notification-events.service';
import { LeaguesService } from '../leagues/leagues.service';
import { ClubsService } from '../clubs/clubs.service';
import { buildRoundCode } from '../matches/round-code.helper';
import { derivePoolSchedule, type PoolMatchTimeRow } from './pool-schedule';
import { sideColorsFromScoringConfig } from './side-colors';
// A zod schema, not a provider — a plain file import, so no module edge to the
// Swiss modules and nothing for module-graph.test.ts to object to.
import { parseSwissConfig } from '../swiss/dto/swiss-config.dto';
import { nextIsoDay } from './date-window';
import {
  buildReadinessSnapshot,
  computeEventReadiness,
  type ReadinessRows,
} from './event-readiness';
import { sanitizePostgrestFilterValue } from '../../common/postgrest-filter';
import type {
  CreateEventDto,
  CreateTournamentDto,
  EventClubQueryDto,
  EventQueryDto,
  RepinTournamentRulesetDto,
  SubmitEventClubRequestDto,
  UpdateEventDto,
  UpdateTournamentDto,
} from './dto/events.dto';
import { PoolStandingsService } from '../pool-standings/pool-standings.service';
import { RulesetResolver } from '../matches/ruleset-resolver.service';
import { RulesetHashService } from '../ruleset-hash/ruleset-hash.service';
import { diffRulesetBuckets, projectRulesetBuckets } from '@myclash/rulesets';
import type { BucketDiff, RulesetBucketInputs } from '@myclash/rulesets';
import {
  normalizeTournamentLockConfig,
  normalizeTournamentScoringConfig,
  validateTournamentRulesetConfig,
} from './tournament-config';
import { deepMergeJson } from '../../common/deep-merge';
import {
  buildCodedForkRow,
  buildSeededScoringConfig,
  freezeRulesetVersion,
  isSystemRuleset,
  normalizeRulesetVersion,
  resolveRulesetConfigDefaults,
  resolveRulesetGrammar,
  resolveRulesetLabel,
} from './ruleset-defaults';
import {
  freezePenaltyRulesetVersion,
  loadPenaltyRulesetVersion,
} from '../penalties/penalty-version.util';

/**
 * Distinct people with an ACTIVE registration across the event, deduped by
 * identity (`persons.global_person_id`, falling back to `person_id`). A fighter
 * entered in two tournaments counts once. "Active" mirrors the registered-total
 * filter: waitlisted/withdrawn/disqualified rows are excluded.
 */
export function countUniqueActiveFighters(
  registrations: Array<{ person_id: string; status: string | null }>,
  globalByPersonId: Map<string, string | null>,
): number {
  const keys = new Set<string>();
  for (const r of registrations) {
    if (['withdrawn', 'disqualified', 'waitlist'].includes(r.status ?? '')) continue;
    keys.add(globalByPersonId.get(r.person_id) ?? r.person_id);
  }
  return keys.size;
}

/** Distinct `person_id` count (person_id already references global_persons). */
export function countDistinctPersonIds(rows: Array<{ person_id: string }>): number {
  return new Set(rows.map((r) => r.person_id)).size;
}

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
  private readonly logger = new Logger(EventsService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly orgs: OrganizationsService,
    private readonly notificationEvents: NotificationEventsService,
    private readonly leagues?: LeaguesService,
    private readonly clubs?: ClubsService,
    // Optional so existing direct-construction unit tests keep working; the
    // app provides it via HemaRatingsModule (imported by EventsModule).
    @Optional() private readonly hemaRatings?: HemaRatingsService,
    // Optional for the same reason; the app provides it via PoolStandingsModule.
    // Used by the audited ruleset re-pin to snapshot before/after placings.
    @Optional() private readonly poolStandings?: PoolStandingsService,
    // Optional for the same reason; provided via RulesetResolverModule. The
    // re-pin uses it to REJECT a target ruleset that won't resolve for scoring.
    @Optional() private readonly rulesetResolver?: RulesetResolver,
    // Optional for the same reason; provided via RulesetHashModule. Computes the
    // tournament's effective content-hash identity, stamped at create/update/re-pin.
    @Optional() private readonly rulesetHash?: RulesetHashService,
  ) {}

  /**
   * Recompute + persist a tournament's effective content-hash identity. Called
   * after any change to its ruleset/config/penalty pin. Best-effort and optional
   * (unit tests construct EventsService without the hash service).
   */
  private async stampTournamentContentHash(tournamentId: string): Promise<void> {
    await this.rulesetHash?.stampTournamentContentHash(tournamentId);
  }

  // ── Events ───────────────────────────────────────────────────────────────────

  async listEvents(query: EventQueryDto) {
    // Spectators poll this endpoint every ~30 s — bound the payload so a
    // 1000-event deploy doesn't ship 1000 rows per poll. Default + max =
    // 100. The cursor enables follow-on pagination by start_date when the
    // FE adds a "load more" affordance.
    const limit = Math.min(query.limit ?? 100, 100);

    // Weapon lives on tournaments, so filtering by it needs an inner embed.
    // Resolve the slug FIRST: an unknown one short-circuits to an empty list
    // without touching events.
    let weaponName: string | null = null;
    if (query.weapon) {
      weaponName = await this.resolveWeaponSlug(query.weapon);
      if (!weaponName) return [];
    }

    // PostgREST resource embedding is a lateral join returning a nested array,
    // NOT a row-multiplying join: an event with three matching tournaments is
    // still one row, so `.limit()` keeps meaning "events". `!inner` drops
    // events whose embed comes back empty.
    const select = weaponName
      ? '*, organizations(name, slug, logo_url, brand_color), tournaments!inner(weapon)'
      : '*, organizations(name, slug, logo_url, brand_color)';

    let q = this.supabase.service
      .from('events')
      .select(select)
      .order('start_date', { ascending: false })
      .limit(limit);

    if (query.status && query.status !== 'all') q = q.eq('status', query.status) as typeof q;
    else q = q.in('status', ['published', 'running', 'completed']) as typeof q;

    // Test events never appear on public surfaces. Club events DO — they are
    // public, they just never count toward rankings or career stats.
    // Predicate text matches idx_events_status_start_date (0162) exactly, so
    // the planner can use the partial index.
    q = q.neq('event_kind', 'test') as typeof q;

    if (query.organizationId) q = q.eq('organization_id', query.organizationId) as typeof q;

    if (query.cursor) q = q.lt('start_date', query.cursor) as typeof q;

    if (weaponName) q = q.eq('tournaments.weapon', weaponName) as typeof q;

    if (query.country) q = q.ilike('country', query.country) as typeof q;

    // Overlap, not containment: a three-day event should surface when the user
    // asks for any single day inside it. Dates are TEXT holding ISO dates, so
    // the comparison is lexicographic and exact.
    if (query.from) q = q.gte('end_date', query.from) as typeof q;
    if (query.to) q = q.lt('start_date', nextIsoDay(query.to)) as typeof q;

    if (query.q) {
      const clauses = await this.buildFreeTextClauses(query.q);
      if (clauses.length > 0) q = q.or(clauses.join(',')) as typeof q;
    }

    const { data, error } = await q;
    if (error) throw new BadRequestException(error.message);
    // Double cast: the select string is now built at runtime (the weapon filter
    // appends an embed), so supabase-js's literal-type select parser resolves
    // it to a ParserError rather than a row shape. Runtime is unaffected.
    const rows = (data ?? []) as unknown as Array<Record<string, unknown>>;
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
      // Drop the `tournaments` key the weapon filter's !inner embed injects.
      // tournament_count is already computed from its own query above, so the
      // embed is a filter mechanism only — leaving it in would make the public
      // payload shape depend on which filters happened to be applied.
      const { tournaments: _weaponFilterEmbed, ...rest } = row;
      return {
        ...rest,
        tournament_count: countByEvent.get(id) ?? 0,
        leagues: leagueMap ? Array.from(leagueMap.values()) : [],
      };
    });
  }

  /**
   * Resolve a weapon_catalog slug to its canonical NAME.
   *
   * tournaments.weapon stores the catalog name as free text, canonicalised on
   * write by resolveCatalogWeapon — so an exact `.eq` on the name is both
   * correct and indexable, where an ilike would not be.
   *
   * Returns null for an unknown slug; the caller turns that into an empty
   * result rather than a 400.
   */
  private async resolveWeaponSlug(slug: string): Promise<string | null> {
    const { data } = await this.supabase.service
      .from('weapon_catalog')
      .select('name')
      .eq('slug', slug)
      .maybeSingle();
    return (data as { name?: string } | null)?.name ?? null;
  }

  /**
   * Build the `.or()` clause list for a free-text search.
   *
   * PostgREST cannot express `parent.col ILIKE x OR child.col ILIKE x` — `.or()`
   * with a referencedTable applies WITHIN the embed, and there is no cross-table
   * OR. So the organiser-name term is resolved to a bounded id list first and
   * folded in as `organization_id.in.(...)`.
   *
   * The 50-id cap is what makes this safe where the same trick would not be for
   * tournaments: supabase-js issues a GET, so the id list rides in the query
   * string. organizations is a small table and the cap keeps the URI short;
   * matching thousands of tournaments the same way would hit a 414.
   *
   * sanitizePostgrestFilterValue is NOT optional here — a `,` or `)` in the
   * user's term would otherwise close the `in.()` list early and inject a
   * sibling filter, which is exactly the injection that helper exists to stop.
   */
  private async buildFreeTextClauses(rawTerm: string): Promise<string[]> {
    const term = sanitizePostgrestFilterValue(rawTerm);
    if (!term) return [];

    const clauses = [`name.ilike.%${term}%`, `city.ilike.%${term}%`, `country.ilike.%${term}%`];

    const { data: orgRows } = await this.supabase.service
      .from('organizations')
      .select('id')
      .ilike('name', `%${term}%`)
      .limit(50);
    const orgIds = ((orgRows ?? []) as Array<{ id: string }>).map((o) => o.id);
    // UUIDs contain no PostgREST metacharacter, so they can't break the list.
    if (orgIds.length > 0) clauses.push(`organization_id.in.(${orgIds.join(',')})`);

    return clauses;
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

    // Which events have at least one recorded result (a match past
    // `scheduled`). Same teardown rule as the hard-delete guard
    // (assertNoRecordedResults): generated-but-unplayed schedules are safe to
    // hard-delete; any non-scheduled match means hard delete is forbidden and
    // the event must go through the deletion-request flow instead. Surfacing
    // this lets the events list show "Request deletion" upfront rather than
    // letting the operator fail a hard delete.
    const eventsWithResults = new Set<string>();
    if (tournamentIds.length > 0) {
      const { data: phaseRows, error: phaseErr } = await this.supabase.service
        .from('phases')
        .select('id, tournament_id')
        .in('tournament_id', tournamentIds);
      if (phaseErr) throw new BadRequestException(phaseErr.message);
      const phaseToEvent = new Map<string, string>();
      for (const p of (phaseRows ?? []) as Array<{ id: string; tournament_id: string }>) {
        const evId = tournamentToEvent.get(p.tournament_id);
        if (evId) phaseToEvent.set(p.id, evId);
      }
      const phaseIds = Array.from(phaseToEvent.keys());
      if (phaseIds.length > 0) {
        const { data: matchRows, error: matchErr } = await this.supabase.service
          .from('matches')
          .select('phase_id')
          .in('phase_id', phaseIds)
          .neq('status', 'scheduled');
        if (matchErr) throw new BadRequestException(matchErr.message);
        for (const m of (matchRows ?? []) as Array<{ phase_id: string }>) {
          const evId = phaseToEvent.get(m.phase_id);
          if (evId) eventsWithResults.add(evId);
        }
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
        has_recorded_results: eventsWithResults.has(evId),
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
      // The embedded lices carry their venue + area so the public display
      // hub can group the picker by hall without a second round-trip —
      // /events/:eventId/lices has the same join but is UUID-gated, and
      // this resolver is the slug-addressed one.
      //
      // Kept as ONE string literal on purpose: supabase-js parses the select
      // at the type level, and splitting it across a `+` collapses the row
      // type to GenericStringError at every call site.
      // prettier-ignore
      .select(
        '*, organizations(name, slug, logo_url, brand_color), themes(*), lices(*, venues(id, name), venue_areas(id, name))',
      );
    const isUuid =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(slug);
    const { data, error } = await (
      isUuid ? query.eq('id', slug) : query.eq('slug', slug)
    ).maybeSingle();

    if (error) throw new BadRequestException(error.message);
    if (!data) throw new NotFoundException(`Event "${slug}" not found`);
    // Test events are invisible to the public — this resolver backs the
    // public GET /events/:slug. Admin reads go through getEventById /
    // listOrgEvents, which keep test events visible to the owning org.
    // Club events resolve normally: they are fully public.
    if (!isPubliclyVisible(asEventKind((data as { event_kind?: string }).event_kind))) {
      throw new NotFoundException(`Event "${slug}" not found`);
    }
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
        event_kind: dto.eventKind ?? DEFAULT_EVENT_KIND,
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
    if (dto.slug !== undefined) {
      // Slug is org-scoped UNIQUE(organization_id, slug). Mirror createEvent's
      // conflict guard, but exclude self so re-patching the same slug is a no-op
      // rather than a false conflict.
      const orgId = (event as { organization_id: string }).organization_id;
      const { data: slugClash } = await this.supabase.service
        .from('events')
        .select('id')
        .eq('organization_id', orgId)
        .eq('slug', dto.slug)
        .neq('id', eventId)
        .maybeSingle();
      if (slugClash)
        throw new ConflictException(`Event slug "${dto.slug}" already exists in this organization`);
      updates['slug'] = dto.slug;
    }
    if (dto.city !== undefined) updates['city'] = dto.city;
    if (dto.country !== undefined) updates['country'] = dto.country;
    if (dto.startDate !== undefined) updates['start_date'] = dto.startDate;
    if (dto.endDate !== undefined) updates['end_date'] = dto.endDate;
    if (dto.timezone !== undefined) updates['timezone'] = dto.timezone;
    if (dto.publicLandingMd !== undefined) updates['public_landing_md'] = dto.publicLandingMd;
    if (dto.status !== undefined) updates['status'] = dto.status;
    if (dto.logoUrl !== undefined) updates['logo_url'] = dto.logoUrl;
    if (dto.aiSpendCapEur !== undefined) updates['ai_spend_cap_eur'] = dto.aiSpendCapEur;
    if (dto.eventKind !== undefined) updates['event_kind'] = dto.eventKind;

    // publishEvent() is the path the admin UI uses, but UpdateEventDto also
    // accepts status:'published' — so the first-publish stamp has to happen
    // here too, or an event published this way would never announce (and would
    // then announce later, wrongly, on its first trip through publishEvent).
    const firstPublishHere =
      dto.status === 'published' &&
      (event as { first_published_at?: string | null }).first_published_at == null;
    if (firstPublishHere) updates['first_published_at'] = new Date().toISOString();

    const previousKind = asEventKind((event as { event_kind?: string }).event_kind);
    const nextKind = dto.eventKind ?? previousKind;
    // League contributions track *stats eligibility*, not the raw kind: a
    // test↔club flip changes nothing (neither is rated), so it must not trigger
    // a pointless full-event recompute.
    const statsEligibilityChanged = countsTowardStats(previousKind) !== countsTowardStats(nextKind);

    const { data, error } = await this.supabase.service
      .from('events')
      .update(updates)
      .eq('id', eventId)
      .select('*')
      .single();

    if (error) throw new BadRequestException(error.message);
    // Recompute league standings on completion, and whenever stats eligibility
    // changes (standard ↔ test|club) — the league gate
    // (computeTournamentContributions) writes empty contributions for a now-
    // unrated event, so recompute drops its rows from league_tournament_results
    // + rankings, and re-adds them on the way back. Self-healing in both
    // directions. Fighter stats need no action: compact_fighter_stats (0162) and
    // the fighters.service career filters read event_kind live, so a kind change
    // is reflected on the next request.
    if (dto.status === 'completed' || statsEligibilityChanged) {
      await this.leagues?.recomputeForEvent(eventId);
    }
    if (firstPublishHere) await this.announceFirstPublish(eventId);
    return data;
  }

  async publishEvent(eventId: string, userId: string) {
    const event = await this.getEventById(eventId);
    await this.orgs.assertOrgRole(
      (event as { organization_id: string }).organization_id,
      userId,
      'admin',
    );

    const nowIso = new Date().toISOString();

    // Compare-and-set on first_published_at: the update only stamps it when it
    // is still null, so exactly one publish in the event's lifetime returns a
    // row here. That is what makes the follower announcement fire once —
    // a republish next month must not re-spam everyone.
    const { data: firstPublish, error: firstErr } = await this.supabase.service
      .from('events')
      .update({ status: 'published', first_published_at: nowIso, updated_at: nowIso })
      .eq('id', eventId)
      .is('first_published_at', null)
      .select('*')
      .maybeSingle();
    if (firstErr) throw new BadRequestException(firstErr.message);

    if (firstPublish) {
      await this.announceFirstPublish(eventId);
      return firstPublish;
    }

    // Already published once before — plain status update, no announcement.
    const { data, error } = await this.supabase.service
      .from('events')
      .update({ status: 'published', updated_at: nowIso })
      .eq('id', eventId)
      .select('*')
      .single();

    if (error) throw new BadRequestException(error.message);
    return data;
  }

  /**
   * Notify the organiser's followers about a newly published event.
   *
   * Wrapped so a notification failure can never fail the publish: the operator
   * pressed "publish", and the event IS published — losing the announcement is
   * a far smaller harm than a 500 that makes them think it did not work.
   */
  private async announceFirstPublish(eventId: string): Promise<void> {
    try {
      await this.notificationEvents.organizerPublishedEvent(eventId);
    } catch (err) {
      this.logger.error(
        `Failed to announce first publish of event ${eventId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
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
    const [registrations, persons, qualificationRows, refereeCounts, phases] = await Promise.all([
      this.getRegistrationsForTournaments(tournamentIds),
      this.getEventPersons(eventId),
      this.getRefereeQualificationPersons(eventId),
      this.countTournamentRefereeAssignments(eventId, tournamentIds),
      this.getPhasesForTournaments(tournamentIds),
    ]);
    const globalByPersonId = new Map(persons.map((person) => [person.id, person.global_person_id]));

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

    // Index phases by tournament. A tournament has at most one phase of each
    // kind, and all three can coexist: pools → Swiss → bracket is a valid
    // three-stage tournament (decision 10).
    const poolPhaseByTournament = new Map<string, { id: string }>();
    const swissPhaseByTournament = new Map<
      string,
      { id: string; config_json: Record<string, unknown> | null }
    >();
    const elimPhaseByTournament = new Map<
      string,
      { id: string; type: string; config_json: Record<string, unknown> | null }
    >();
    for (const phase of phases) {
      if (phase.type === 'pool') {
        poolPhaseByTournament.set(phase.tournament_id, { id: phase.id });
      } else if (phase.type === 'swiss') {
        swissPhaseByTournament.set(phase.tournament_id, {
          id: phase.id,
          config_json: phase.config_json,
        });
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
        uniqueFighters: countUniqueActiveFighters(registrations, globalByPersonId),
        uniqueReferees: countDistinctPersonIds(qualificationRows),
        clubsRepresented: representedClubIds.size,
      },
      tournaments: tournaments.map((tournament) => {
        const poolPhase = poolPhaseByTournament.get(tournament.id);
        const swissPhase = swissPhaseByTournament.get(tournament.id);
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
          // The CONFIGURED round count, not the rounds generated so far: the
          // overview answers "how long is this format", and a Swiss phase on
          // the morning of the event has exactly one round in the table.
          swissRoundCount: swissPhase
            ? (parseSwissConfig(swissPhase.config_json)?.roundCount ?? null)
            : null,
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
   * Readiness pre-flight for an event: what still stands between it and being
   * runnable, per tournament. The rules live in `event-readiness.ts`; this
   * method only gathers the rows they judge.
   *
   * A SEPARATE read from `getEventDashboardStats` on purpose. That method is
   * already long and carries the whole dashboard payload; the readiness panel
   * loads on its own, and the publish flow wants the checklist without any of
   * the rest. Same `scorekeeper` gate — readiness is organiser-only detail.
   */
  async getEventReadiness(eventId: string, userId: string) {
    const event = (await this.getEventById(eventId)) as {
      id: string;
      organization_id: string;
      status: string;
    };
    await this.orgs.assertOrgRole(event.organization_id, userId, 'scorekeeper');

    const rows = await this.loadReadinessRows(eventId);
    return {
      eventId: event.id,
      eventStatus: event.status,
      tournaments: rows.tournaments.map(({ id, name }) => ({ id, name })),
      ...computeEventReadiness(buildReadinessSnapshot(rows)),
    };
  }

  /** The rows the readiness rules judge. Gathering only — no rules here. */
  private async loadReadinessRows(eventId: string): Promise<ReadinessRows> {
    const tournaments = await this.getEventTournaments(eventId);
    const tournamentIds = tournaments.map((tournament) => tournament.id);
    const [registrations, phases, liceCount] = await Promise.all([
      this.getRegistrationsForTournaments(tournamentIds),
      this.getPhasesForTournaments(tournamentIds),
      this.countEventLices(eventId),
    ]);

    // Nothing hangs off an event with no phases, and assignments can only
    // point at a pool or a match — so skip the whole second batch rather than
    // firing four round-trips whose answers cannot matter.
    const phaseIds = phases.map((phase) => phase.id);
    const [pools, swissRounds, matches, refereeAssignments] =
      phaseIds.length === 0
        ? [[], [], [], []]
        : await Promise.all([
            this.getPoolsForPhases(phaseIds),
            this.getSwissRoundsForPhases(phaseIds),
            this.getMatchScheduleRowsForPhases(phaseIds),
            this.getLiveRefereeAssignmentScopes(eventId),
          ]);

    return {
      liceCount,
      tournaments: tournaments.map((tournament) => ({
        id: tournament.id,
        name: tournament.name,
        ruleset_code: tournament.ruleset_code,
      })),
      registrations,
      phases,
      pools,
      swissRounds,
      matches,
      refereeAssignments,
    };
  }

  /**
   * Distinct-people headcounts for an event, shared by the Command Center
   * dashboard and the organizer statistics page so both surfaces agree:
   * - uniqueFighters: distinct people with an active registration
   * - uniqueReferees: distinct qualified referees
   * The dashboard computes these inline from data it already loads; this
   * method is the standalone path for callers (e.g. EventStatsService) that
   * don't otherwise fetch registrations/persons/qualifications.
   */
  async getEventUniqueParticipantCounts(
    eventId: string,
  ): Promise<{ uniqueFighters: number; uniqueReferees: number }> {
    const tournamentIds = (await this.getEventTournaments(eventId)).map((t) => t.id);
    const [registrations, persons, qualifications] = await Promise.all([
      this.getRegistrationsForTournaments(tournamentIds),
      this.getEventPersons(eventId),
      this.getRefereeQualificationPersons(eventId),
    ]);
    const globalByPersonId = new Map(persons.map((person) => [person.id, person.global_person_id]));
    return {
      uniqueFighters: countUniqueActiveFighters(registrations, globalByPersonId),
      uniqueReferees: countDistinctPersonIds(qualifications),
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
    // Test and club events are both disposable: a test event is a throwaway dry
    // run, and a club event's results never fed rankings or career stats. Either
    // way tearing it down destroys nothing anyone else depends on, so the org
    // admin can hard-delete it directly — results and all, with no
    // archive/deletion-request detour.
    const directDelete = allowsDirectHardDelete(
      asEventKind((event as { event_kind?: string }).event_kind),
    );
    if (!directDelete && (event as { status: string }).status === 'archived') {
      throw new ForbiddenException(
        'Archived events require super-admin approval. Submit a deletion request.',
      );
    }

    await this.orgs.assertOrgRole(
      (event as { organization_id: string }).organization_id,
      userId,
      'admin',
    );

    // A bare `delete events` relies on the DB cascade, but the diamond cascade
    // (events→persons CASCADE vs events→tournaments→registrations) trips the
    // RESTRICT FKs registrations.person_id and matches.*_registration_id, which
    // Postgres checks immediately. So tear the result graph down in dependency
    // order first — after refusing any event that holds real (scored) results.
    const { data: tournamentRows } = await this.supabase.service
      .from('tournaments')
      .select('id')
      .eq('event_id', eventId);
    const tournamentIds = ((tournamentRows ?? []) as Array<{ id: string }>).map((t) => t.id);

    if (!directDelete) {
      await this.assertNoRecordedResults(
        tournamentIds,
        'This event has recorded match results. Submit a deletion request instead of a hard delete.',
      );
    }
    // Clear referee assignments up-front: deleting their matches/pools/lices would
    // SET NULL the scope columns and violate referee_assignments_scope_check.
    const { error: raErr } = await this.supabase.service
      .from('referee_assignments')
      .delete()
      .eq('event_id', eventId);
    if (raErr) throw new BadRequestException(raErr.message);
    await this.clearTournamentResultGraph(tournamentIds);

    const { error } = await this.supabase.service.from('events').delete().eq('id', eventId);
    if (error) throw new BadRequestException(error.message);
    return { deleted: true, id: eventId };
  }

  async getPublicTournamentStandings(eventSlug: string, tournamentSlug: string) {
    const event = await this.getEventBySlug(eventSlug);
    const eventId = (event as { id: string }).id;

    const { data: tournament, error: tournamentError } = await this.supabase.service
      .from('tournaments')
      .select(
        'id, name, weapon, ruleset_code, ruleset_version, status, logo_url, color, scoring_config_json',
      )
      .eq('event_id', eventId)
      .eq('slug', tournamentSlug)
      .maybeSingle();
    if (tournamentError) throw new BadRequestException(tournamentError.message);
    if (!tournament) throw new NotFoundException(`Tournament ${tournamentSlug} not found`);

    const rulesetLabel = await resolveRulesetLabel(
      this.supabase,
      tournament['ruleset_code'] as string,
      (tournament['ruleset_version'] as string | null) ?? '1',
    );

    // Tournament status is the canonical public gate. When the
    // tournament hasn't been published yet, the public page shows
    // nothing structural even if phases happen to exist. Once
    // published / running / completed, every phase is visible —
    // operators don't actually stage pool→bracket reveals per phase,
    // so layering phase-visibility on top was a UX trap (operator
    // publishes the tournament, public sees nothing, no clue why).
    const tournamentStatus = (tournament as { status: string }).status;
    const publicTournamentStatuses = ['published', 'running', 'completed'];
    const tournamentId = (tournament as { id: string }).id;
    const rulesetRepin = await this.loadLatestRulesetRepin(tournamentId);
    const tournamentHeader: Record<string, unknown> = {
      id: tournament['id'],
      // Public disclosure of an audited mid-event ruleset re-pin (null when the
      // tournament was never re-pinned). Never silent — see the re-pin ceremony.
      rulesetRepin,
      name: tournament['name'],
      weapon: tournament['weapon'],
      // The organiser's configured fighter-side colours, so the public bracket
      // paints the same corners the pad and the projector do.
      sideColors: sideColorsFromScoringConfig(tournament['scoring_config_json']),
      rulesetCode: tournament['ruleset_code'],
      rulesetLabel,
      status: tournament['status'],
      logoUrl: (tournament['logo_url'] as string | null) ?? null,
      // Optional brand color token (e.g. 'red', 'blue'). The public
      // page threads this through tab underlines, card outlines, and
      // section titles via @myclash/ui's color-token helpers.
      color: (tournament['color'] as string | null) ?? null,
      // Aggregate counts surfaced for the redesigned public cards.
      // Zero defaults so the early-return path (draft/archived) is
      // shape-compatible with the published path.
      participantCount: 0,
      waitlistCount: 0,
      refereeCount: 0,
      poolCount: 0,
      completedMatchCount: 0,
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
      .eq('tournament_id', tournamentId);
    if (phasesError) throw new BadRequestException(phasesError.message);

    const phaseRows = (phases ?? []) as Array<Record<string, unknown>>;
    const phaseIds = phaseRows
      .map((p) => p['id'])
      .filter((id): id is string => typeof id === 'string');

    // Aggregate counts for the public tournament card. Each query is
    // cheap (single COUNT) and uses Supabase's { count: 'exact', head:
    // true } pattern to avoid pulling rows.
    const participantsAgg = await this.supabase.service
      .from('registrations')
      .select('id', { count: 'exact', head: true })
      .eq('tournament_id', tournamentId)
      .in('status', ['registered', 'checked_in']);
    tournamentHeader['participantCount'] = participantsAgg.count ?? 0;

    const waitlistAgg = await this.supabase.service
      .from('registrations')
      .select('id', { count: 'exact', head: true })
      .eq('tournament_id', tournamentId)
      .eq('status', 'waitlist');
    tournamentHeader['waitlistCount'] = waitlistAgg.count ?? 0;

    if (phaseIds.length > 0) {
      const completedAgg = await this.supabase.service
        .from('matches')
        .select('id', { count: 'exact', head: true })
        .in('phase_id', phaseIds)
        .eq('status', 'completed');
      tournamentHeader['completedMatchCount'] = completedAgg.count ?? 0;
    }

    const poolPhase = phaseRows.find((phase) => phase['type'] === 'pool');
    const bracketPhase = phaseRows.find(
      (phase) => phase['type'] === 'single_elim' || phase['type'] === 'double_elim',
    );
    const swiss = await this.resolveSwissSummary(phaseRows);

    const pools =
      poolPhase && typeof poolPhase['id'] === 'string'
        ? await this.getPublishedPools(poolPhase['id'], eventId)
        : [];
    const bracket =
      bracketPhase && typeof bracketPhase['id'] === 'string'
        ? await this.getPublishedBracket(bracketPhase, eventId)
        : {
            bracketSlots: [],
            bracketSize: 0,
            bracketRounds: 0,
            // A Swiss phase has no bracket, so it must NOT wear the single-elim
            // default: `computeFinalRanking` reads this to choose its ordering,
            // and 'single_elim' here would rank a Swiss field off an empty slot
            // tree and return nothing at all.
            phaseType: (swiss.swissPhaseId ? 'swiss' : 'single_elim') as
              'single_elim' | 'double_elim' | 'swiss',
            wbRounds: null,
            lbRounds: null,
            secondChanceTarget: 'gold' as const,
            bronzeMatch: null,
            repechageEntryRound: null,
          };

    tournamentHeader['poolCount'] = pools.length;
    tournamentHeader['refereeCount'] = pools.reduce(
      (acc, p) => acc + ((p as { referees?: unknown[] }).referees?.length ?? 0),
      0,
    );

    return {
      tournament: tournamentHeader,
      pools,
      ...bracket,
      ...swiss,
    };
  }

  /**
   * What the public page needs to know about a Swiss phase without loading it.
   *
   * The rounds themselves come from `GET /tournaments/:id/swiss`, which the tab
   * fetches live. These four fields are what the SERVER render needs: whether
   * to show the tab at all, whether the Standings tab is reachable (it used to
   * be gated on `pools.length > 0`, which hid it for a Swiss-only tournament),
   * and whether the podium has resolved.
   */
  private async resolveSwissSummary(phaseRows: Array<Record<string, unknown>>) {
    const swissPhase = phaseRows.find((phase) => phase['type'] === 'swiss');
    const phaseId = typeof swissPhase?.['id'] === 'string' ? swissPhase['id'] : null;
    if (!phaseId) {
      return {
        swissPhaseId: null,
        swissRoundCount: 0,
        swissRoundsCompleted: 0,
        swissFinalized: false,
      };
    }

    const config = parseSwissConfig(swissPhase?.['config_json']);
    const { data: rounds } = await this.supabase.service
      .from('swiss_rounds')
      .select('id, status')
      .eq('phase_id', phaseId);
    const roundRows = (rounds ?? []) as Array<{ status: string }>;

    return {
      swissPhaseId: phaseId,
      swissRoundCount: config?.roundCount ?? roundRows.length,
      swissRoundsCompleted: roundRows.filter((round) => round.status === 'completed').length,
      swissFinalized: Boolean(config?.finalized),
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
    // Event IANA timezone — the client renders each pool's scheduled date/time
    // in it (defaults to Europe/Paris when unset).
    const timezone = (event as { timezone?: string | null }).timezone ?? 'Europe/Paris';

    const { data: tournament, error: tournamentError } = await this.supabase.service
      .from('tournaments')
      .select('id, weapon, status, scoring_config_json')
      .eq('event_id', eventId)
      .eq('slug', tournamentSlug)
      .maybeSingle();
    if (tournamentError) throw new BadRequestException(tournamentError.message);
    if (!tournament) throw new NotFoundException(`Tournament ${tournamentSlug} not found`);
    // Configured fighter-side colour tokens (default red/blue). The client
    // resolves these to hex via `sideStyle` for the matches-table accent bar,
    // matching the admin Pools → Matches view.
    const sideColors = sideColorsFromScoringConfig(
      (tournament as { scoring_config_json?: unknown }).scoring_config_json,
    );
    const tournamentStatus = (tournament as { status: string }).status;
    if (!['published', 'running', 'completed'].includes(tournamentStatus)) {
      return { tournamentId: (tournament as { id: string }).id, sideColors, timezone, pools: [] };
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
    if (!phaseRow) return { tournamentId, sideColors, timezone, pools: [] };
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
    if (pools.length === 0) return { tournamentId, sideColors, timezone, pools: [] };

    const poolIds = pools.map((p) => p.id);

    // 3. Matches for these pools. Nested joins resolve fighter names
    //    via registrations → persons → clubs and the lice row for
    //    color + name. Status / scores come straight off the matches
    //    table.
    const { data: matchesData, error: matchesError } = await this.supabase.service
      .from('matches')
      .select(
        'id, status, scheduled_at, match_number_label, red_score, blue_score, pool_id, lice_id, ' +
          'red:registrations!matches_red_registration_id_fkey(id, persons(given_name, family_name, clubs(name, abbreviation))), ' +
          'blue:registrations!matches_blue_registration_id_fkey(id, persons(given_name, family_name, clubs(name, abbreviation))), ' +
          'lices(id, name, color_hex)',
      )
      .in('pool_id', poolIds)
      .order('pool_id', { ascending: true })
      .order('match_number_label', { ascending: true });
    if (matchesError) throw new BadRequestException(matchesError.message);

    type PersonClubEmbed = {
      given_name: string | null;
      family_name: string | null;
      clubs: { name: string | null; abbreviation: string | null } | null;
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
      // Prefer the abbreviation; fall back to the full club name so the
      // public club pill renders even for clubs without an abbreviation.
      return side?.persons?.clubs?.abbreviation ?? side?.persons?.clubs?.name ?? null;
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
      sideColors,
      timezone,
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
            redRegistrationId: m.red?.id ?? null,
            redScore: m.red_score,
            blueFighterName: nameFrom(m.blue),
            blueClubAbbrev: clubAbbrevFrom(m.blue),
            blueRegistrationId: m.blue?.id ?? null,
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

    // Decorate each row with aggregates the public event home renders
    // on its tournament cards: `registered`, `waitlistCount`,
    // `poolCount`, `bracketSize`, `completedMatchCount`. Each lookup
    // is a single grouped query across all tournaments — O(1)
    // round-trips regardless of how many tournaments the event has.
    const tournamentIds = tournaments
      .map((t) => (t['id'] as string | undefined) ?? null)
      .filter((id): id is string => Boolean(id));

    // Registered + checked_in (mirrors registrations.service.assertCapacity).
    const { data: regRows } = await this.supabase.service
      .from('registrations')
      .select('tournament_id, status')
      .in('tournament_id', tournamentIds)
      .in('status', ['registered', 'checked_in']);

    const registered = new Map<string, number>();
    for (const row of (regRows ?? []) as Array<{ tournament_id: string }>) {
      registered.set(row.tournament_id, (registered.get(row.tournament_id) ?? 0) + 1);
    }

    // Waitlist (status='waitlist'; see migration 0078 + the registrations
    // schema gate).
    const { data: waitlistRows } = await this.supabase.service
      .from('registrations')
      .select('tournament_id')
      .in('tournament_id', tournamentIds)
      .eq('status', 'waitlist');

    const waitlistCounts = new Map<string, number>();
    for (const row of (waitlistRows ?? []) as Array<{ tournament_id: string }>) {
      waitlistCounts.set(row.tournament_id, (waitlistCounts.get(row.tournament_id) ?? 0) + 1);
    }

    // Phases (drives poolCount + bracketSize via config_json.bracketSize).
    const { data: phaseRows } = await this.supabase.service
      .from('phases')
      .select('id, tournament_id, type, config_json')
      .in('tournament_id', tournamentIds);

    const phasesByTournament = new Map<string, Array<Record<string, unknown>>>();
    const phaseIdToTournament = new Map<string, string>();
    // Pool vs bracket phase → tournament, so each match can be bucketed into a
    // pool-fight or a bracket/finals-fight ratio. Bracket = every non-pool phase.
    const poolPhaseIdToTournament = new Map<string, string>();
    const bracketPhaseIdToTournament = new Map<string, string>();
    for (const row of (phaseRows ?? []) as Array<Record<string, unknown>>) {
      const tournamentId = row['tournament_id'] as string;
      const phaseId = row['id'] as string;
      const list = phasesByTournament.get(tournamentId) ?? [];
      list.push(row);
      phasesByTournament.set(tournamentId, list);
      phaseIdToTournament.set(phaseId, tournamentId);
      if (row['type'] === 'pool') poolPhaseIdToTournament.set(phaseId, tournamentId);
      else bracketPhaseIdToTournament.set(phaseId, tournamentId);
    }

    // Pools (grouped by phase_id, summed per tournament). Also keeps a
    // pool→tournament map for the referee-count lookup below.
    const allPhaseIds = Array.from(phaseIdToTournament.keys());
    const poolCounts = new Map<string, number>();
    const poolIdToTournament = new Map<string, string>();
    if (allPhaseIds.length > 0) {
      const { data: poolRows } = await this.supabase.service
        .from('pools')
        .select('id, phase_id')
        .in('phase_id', allPhaseIds);
      for (const row of (poolRows ?? []) as Array<{ id: string; phase_id: string }>) {
        const tournamentId = phaseIdToTournament.get(row.phase_id);
        if (!tournamentId) continue;
        poolCounts.set(tournamentId, (poolCounts.get(tournamentId) ?? 0) + 1);
        poolIdToTournament.set(row.id, tournamentId);
      }
    }

    // Matches across all phases → bucket into pool vs bracket fight ratios
    // (total + completed) per tournament.
    const poolFightsTotal = new Map<string, number>();
    const poolFightsCompleted = new Map<string, number>();
    const bracketFightsTotal = new Map<string, number>();
    const bracketFightsCompleted = new Map<string, number>();
    // Earliest / latest scheduled match per tournament → drives the schedule
    // window on the public event-home "Schedule" agenda.
    const scheduledStartByTournament = new Map<string, string>();
    const scheduledEndByTournament = new Map<string, string>();
    if (allPhaseIds.length > 0) {
      const { data: matchRows } = await this.supabase.service
        .from('matches')
        .select('phase_id, status, scheduled_at')
        .in('phase_id', allPhaseIds);
      for (const row of (matchRows ?? []) as Array<{
        phase_id: string;
        status: string | null;
        scheduled_at: string | null;
      }>) {
        const poolTournamentId = poolPhaseIdToTournament.get(row.phase_id);
        const done = row.status === 'completed';
        const matchTournamentId = phaseIdToTournament.get(row.phase_id);
        if (matchTournamentId && row.scheduled_at) {
          const curStart = scheduledStartByTournament.get(matchTournamentId);
          if (!curStart || row.scheduled_at < curStart) {
            scheduledStartByTournament.set(matchTournamentId, row.scheduled_at);
          }
          const curEnd = scheduledEndByTournament.get(matchTournamentId);
          if (!curEnd || row.scheduled_at > curEnd) {
            scheduledEndByTournament.set(matchTournamentId, row.scheduled_at);
          }
        }
        if (poolTournamentId) {
          poolFightsTotal.set(poolTournamentId, (poolFightsTotal.get(poolTournamentId) ?? 0) + 1);
          if (done) {
            poolFightsCompleted.set(
              poolTournamentId,
              (poolFightsCompleted.get(poolTournamentId) ?? 0) + 1,
            );
          }
          continue;
        }
        const bracketTournamentId = bracketPhaseIdToTournament.get(row.phase_id);
        if (bracketTournamentId) {
          bracketFightsTotal.set(
            bracketTournamentId,
            (bracketFightsTotal.get(bracketTournamentId) ?? 0) + 1,
          );
          if (done) {
            bracketFightsCompleted.set(
              bracketTournamentId,
              (bracketFightsCompleted.get(bracketTournamentId) ?? 0) + 1,
            );
          }
        }
      }
    }

    // Distinct referees per tournament — pool-assigned (referee_assignments via
    // pool → tournament). Mirrors the pool-list footer's referee source.
    const refereeSets = new Map<string, Set<string>>();
    const allPoolIds = Array.from(poolIdToTournament.keys());
    if (allPoolIds.length > 0) {
      const { data: refRows } = await this.supabase.service
        .from('referee_assignments')
        .select('pool_id, person_id')
        .in('pool_id', allPoolIds)
        .eq('event_id', eventId)
        .in('status', ['assigned', 'confirmed', 'pending']);
      for (const row of (refRows ?? []) as Array<{
        pool_id: string | null;
        person_id: string | null;
      }>) {
        if (!row.pool_id || !row.person_id) continue;
        const tournamentId = poolIdToTournament.get(row.pool_id);
        if (!tournamentId) continue;
        const set = refereeSets.get(tournamentId) ?? new Set<string>();
        set.add(row.person_id);
        refereeSets.set(tournamentId, set);
      }
    }

    // Per-phase venue assignment (pools / swiss / bracket) → drives the
    // tournament-list "Venue(s)" column. One grouped query across all
    // tournaments.
    type PhaseVenue = { id: string; name: string } | null;
    type TournamentPhaseVenues = { pool: PhaseVenue; swiss: PhaseVenue; bracket: PhaseVenue };
    const emptyPhaseVenues = (): TournamentPhaseVenues => ({
      pool: null,
      swiss: null,
      bracket: null,
    });
    const phaseVenuesByTournament = new Map<string, TournamentPhaseVenues>();
    const { data: phaseVenueRows } = await this.supabase.service
      .from('tournament_phase_venues')
      .select('tournament_id, phase_kind, venues(id, name)')
      .in('tournament_id', tournamentIds);
    for (const row of (phaseVenueRows ?? []) as unknown as Array<{
      tournament_id: string;
      phase_kind: string;
      venues: { id: string; name: string } | null;
    }>) {
      const cur = phaseVenuesByTournament.get(row.tournament_id) ?? emptyPhaseVenues();
      const venue = row.venues
        ? { id: String(row.venues.id), name: String(row.venues.name) }
        : null;
      if (row.phase_kind === 'pool') cur.pool = venue;
      else if (row.phase_kind === 'swiss') cur.swiss = venue;
      else if (row.phase_kind === 'bracket') cur.bracket = venue;
      phaseVenuesByTournament.set(row.tournament_id, cur);
    }

    return tournaments.map((t) => {
      const id = (t['id'] as string) ?? '';
      const phases = phasesByTournament.get(id) ?? [];
      const bracketPhase = phases.find(
        (p) => p['type'] === 'single_elim' || p['type'] === 'double_elim',
      );
      const bracketSizeRaw = ((bracketPhase?.['config_json'] as
        Record<string, unknown> | undefined) ?? {})['bracketSize'];
      const bracketSize = typeof bracketSizeRaw === 'number' ? bracketSizeRaw : 0;
      return {
        ...t,
        registered: registered.get(id) ?? 0,
        waitlistCount: waitlistCounts.get(id) ?? 0,
        poolCount: poolCounts.get(id) ?? 0,
        bracketSize,
        poolFightsTotal: poolFightsTotal.get(id) ?? 0,
        poolFightsCompleted: poolFightsCompleted.get(id) ?? 0,
        bracketFightsTotal: bracketFightsTotal.get(id) ?? 0,
        bracketFightsCompleted: bracketFightsCompleted.get(id) ?? 0,
        refereeCount: refereeSets.get(id)?.size ?? 0,
        scheduledStart: scheduledStartByTournament.get(id) ?? null,
        scheduledEnd: scheduledEndByTournament.get(id) ?? null,
        phaseVenues: phaseVenuesByTournament.get(id) ?? emptyPhaseVenues(),
      };
    });
  }

  /**
   * Slice 3a of the public microsite overhaul: every person registered
   * to a tournament on this event, grouped into one row per person
   * with the tournaments they're entered in. Public — no auth.
   *
   * Includes active registrations (`registered`, `checked_in`) AND
   * waitlist entries. Each tournament entry carries a
   * `registrationState` of `'active'` or `'waitlist'`; waitlist
   * entries also carry `waitlistPosition` so consumers can render the
   * ordered waitlist queue.
   *
   * Excludes withdrawn / disqualified registrations.
   */
  async listPublicParticipants(
    slugOrId: string,
    opts?: { includeStaff?: boolean },
  ): Promise<
    Array<{
      personId: string | null;
      globalPersonId: string;
      displayName: string;
      clubName: string | null;
      clubAbbrev: string | null;
      isReferee: boolean;
      isInstructor: boolean;
      tournaments: Array<{
        id: string;
        slug: string;
        name: string;
        color: string | null;
        registrationState: 'active' | 'waitlist';
        waitlistPosition: number | null;
        hemaRating: WeaponRating | null;
      }>;
    }>
  > {
    const event = await this.getEventBySlug(slugOrId);
    const eventId = (event as { id: string }).id;
    // Staff (referees/instructors) who don't compete are only appended when the
    // caller opts in — the roster is otherwise registration-only so the event
    // home counts and per-tournament lists stay untouched.
    const includeStaff = opts?.includeStaff ?? false;

    const { data: tournamentRows, error: tournErr } = await this.supabase.service
      .from('tournaments')
      .select('id, slug, name, color, weapon')
      .eq('event_id', eventId);
    if (tournErr) throw new BadRequestException(tournErr.message);
    const tournaments = (tournamentRows ?? []) as Array<{
      id: string;
      slug: string;
      name: string;
      color: string | null;
      weapon: string | null;
    }>;
    if (tournaments.length === 0 && !includeStaff) return [];
    const tournamentById = new Map(tournaments.map((t) => [t.id, t]));

    let registrations: Array<{
      tournament_id: string;
      person_id: string;
      status: string;
      waitlist_position: number | null;
    }> = [];
    if (tournaments.length > 0) {
      const { data: regRows, error: regErr } = await this.supabase.service
        .from('registrations')
        .select('tournament_id, person_id, status, waitlist_position')
        .in(
          'tournament_id',
          tournaments.map((t) => t.id),
        )
        .in('status', ['registered', 'checked_in', 'waitlist']);
      if (regErr) throw new BadRequestException(regErr.message);
      registrations = (regRows ?? []) as Array<{
        tournament_id: string;
        person_id: string;
        status: string;
        waitlist_position: number | null;
      }>;
    }
    if (registrations.length === 0 && !includeStaff) return [];

    const personIds = Array.from(new Set(registrations.map((r) => r.person_id)));
    let persons: Array<{
      id: string;
      given_name: string;
      family_name: string;
      club_id: string | null;
      hema_ratings_id: string | null;
      global_person_id: string | null;
    }> = [];
    if (personIds.length > 0) {
      const { data: personRows, error: personErr } = await this.supabase.service
        .from('persons')
        .select('id, given_name, family_name, club_id, hema_ratings_id, global_person_id')
        .in('id', personIds);
      if (personErr) throw new BadRequestException(personErr.message);
      persons = (personRows ?? []) as Array<{
        id: string;
        given_name: string;
        family_name: string;
        club_id: string | null;
        hema_ratings_id: string | null;
        global_person_id: string | null;
      }>;
    }
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

    // Referee roster for the event (global-person-keyed). A participant whose
    // global_person_id is in this set is also a referee for the event.
    const refereeGlobalIds = new Set<string>();
    {
      const { data: refRows } = await this.supabase.service
        .from('event_referees')
        .select('person_id')
        .eq('event_id', eventId);
      for (const r of (refRows ?? []) as Array<{ person_id: string | null }>) {
        if (r.person_id) refereeGlobalIds.add(r.person_id);
      }
    }

    // Instructor roster for the event (global-person-keyed), mirrors event_referees.
    const instructorGlobalIds = new Set<string>();
    {
      const { data: instRows } = await this.supabase.service
        .from('event_instructors')
        .select('person_id')
        .eq('event_id', eventId);
      for (const i of (instRows ?? []) as Array<{ person_id: string | null }>) {
        if (i.person_id) instructorGlobalIds.add(i.person_id);
      }
    }

    // HEMA rating per tournament weapon, resolved by linked id OR a unique name
    // match. One resolve() per distinct weapon; ids + names gathered from all
    // persons. No-ops gracefully when HemaRatingsService isn't provided.
    const displayNameById = new Map(
      persons.map((p) => [p.id, `${p.given_name} ${p.family_name}`.trim()]),
    );
    const ratingsByWeapon = new Map<
      string,
      { byId: Map<string, WeaponRating>; byName: Map<string, WeaponRating> }
    >();
    if (this.hemaRatings) {
      const hemaIds = Array.from(
        new Set(persons.map((p) => p.hema_ratings_id).filter((id): id is string => !!id)),
      );
      const allNames = Array.from(new Set(displayNameById.values()));
      const weapons = Array.from(
        new Set(tournaments.map((t) => t.weapon).filter((w): w is string => !!w)),
      );
      for (const weapon of weapons) {
        ratingsByWeapon.set(
          weapon,
          await this.hemaRatings.resolveWeaponRatings(hemaIds, allNames, weapon),
        );
      }
    }
    const ratingFor = (
      person: { id: string; hema_ratings_id: string | null },
      weapon: string | null,
    ): WeaponRating | null => {
      if (!weapon) return null;
      const maps = ratingsByWeapon.get(weapon);
      if (!maps) return null;
      const byId = person.hema_ratings_id ? maps.byId.get(person.hema_ratings_id) : undefined;
      if (byId) return byId;
      const name = displayNameById.get(person.id);
      if (!name) return null;
      return maps.byName.get(normalizePersonName(name)) ?? null;
    };

    const byPerson = new Map<
      string,
      {
        personId: string | null;
        globalPersonId: string;
        displayName: string;
        clubName: string | null;
        clubAbbrev: string | null;
        isReferee: boolean;
        isInstructor: boolean;
        tournaments: Array<{
          id: string;
          slug: string;
          name: string;
          color: string | null;
          registrationState: 'active' | 'waitlist';
          waitlistPosition: number | null;
          hemaRating: WeaponRating | null;
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
          globalPersonId: person.global_person_id ?? person.id,
          displayName: `${person.given_name} ${person.family_name}`.trim() || person.id,
          clubName: club?.name ?? null,
          clubAbbrev: club?.abbreviation ?? null,
          isReferee: person.global_person_id
            ? refereeGlobalIds.has(person.global_person_id)
            : false,
          isInstructor: person.global_person_id
            ? instructorGlobalIds.has(person.global_person_id)
            : false,
          tournaments: [],
        };
        byPerson.set(reg.person_id, row);
      }
      row.tournaments.push({
        id: tournament.id,
        slug: tournament.slug,
        name: tournament.name,
        color: tournament.color,
        registrationState: reg.status === 'waitlist' ? 'waitlist' : 'active',
        waitlistPosition: reg.waitlist_position,
        hemaRating: ratingFor(person, tournament.weapon),
      });
    }

    // Append referees/instructors who aren't registered in any tournament.
    // Their canonical identity is global_persons.id; resolve display via an
    // event persons row (gives a profile link) when one exists, else fall back
    // to global_persons (personId stays null → the roster renders them unlinked).
    if (includeStaff) {
      const covered = new Set<string>();
      for (const row of byPerson.values()) covered.add(row.globalPersonId);
      const missing = Array.from(
        new Set<string>([...refereeGlobalIds, ...instructorGlobalIds]),
      ).filter((id) => !covered.has(id));

      if (missing.length > 0) {
        const staffRows: Array<{
          personId: string | null;
          globalPersonId: string;
          displayName: string;
          clubId: string | null;
        }> = [];
        const extraClubIds = new Set<string>();
        const resolvedGlobalIds = new Set<string>();

        // Pass 1 — event-scoped persons rows linked by global_person_id.
        const { data: staffPersonRows } = await this.supabase.service
          .from('persons')
          .select('id, given_name, family_name, club_id, global_person_id')
          .eq('event_id', eventId)
          .in('global_person_id', missing);
        for (const sp of (staffPersonRows ?? []) as Array<{
          id: string;
          given_name: string;
          family_name: string;
          club_id: string | null;
          global_person_id: string | null;
        }>) {
          if (!sp.global_person_id || resolvedGlobalIds.has(sp.global_person_id)) continue;
          resolvedGlobalIds.add(sp.global_person_id);
          if (sp.club_id) extraClubIds.add(sp.club_id);
          staffRows.push({
            personId: sp.id,
            globalPersonId: sp.global_person_id,
            displayName: `${sp.given_name} ${sp.family_name}`.trim() || sp.global_person_id,
            clubId: sp.club_id,
          });
        }

        // Pass 2 — global_persons fallback for staff with no event persons row.
        const stillMissing = missing.filter((id) => !resolvedGlobalIds.has(id));
        if (stillMissing.length > 0) {
          const { data: gpRows } = await this.supabase.service
            .from('global_persons')
            .select('id, given_name, family_name, display_name, club_id')
            .in('id', stillMissing);
          for (const gp of (gpRows ?? []) as Array<{
            id: string;
            given_name: string | null;
            family_name: string | null;
            display_name: string | null;
            club_id: string | null;
          }>) {
            if (gp.club_id) extraClubIds.add(gp.club_id);
            const name =
              `${gp.given_name ?? ''} ${gp.family_name ?? ''}`.trim() ||
              (gp.display_name ?? '').trim() ||
              gp.id;
            staffRows.push({
              personId: null,
              globalPersonId: gp.id,
              displayName: name,
              clubId: gp.club_id,
            });
          }
        }

        // Resolve any club labels not already cached.
        const newClubIds = Array.from(extraClubIds).filter((id) => !clubById.has(id));
        if (newClubIds.length > 0) {
          const { data: clubRows } = await this.supabase.service
            .from('clubs')
            .select('id, name, abbreviation')
            .in('id', newClubIds);
          for (const c of (clubRows ?? []) as Array<{
            id: string;
            name: string;
            abbreviation: string | null;
          }>) {
            clubById.set(c.id, { name: c.name, abbreviation: c.abbreviation });
          }
        }

        for (const sr of staffRows) {
          const club = sr.clubId ? (clubById.get(sr.clubId) ?? null) : null;
          byPerson.set(sr.globalPersonId, {
            personId: sr.personId,
            globalPersonId: sr.globalPersonId,
            displayName: sr.displayName,
            clubName: club?.name ?? null,
            clubAbbrev: club?.abbreviation ?? null,
            isReferee: refereeGlobalIds.has(sr.globalPersonId),
            isInstructor: instructorGlobalIds.has(sr.globalPersonId),
            tournaments: [],
          });
        }
      }
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

  private async getRefereeQualificationPersons(eventId: string) {
    const { data, error } = await this.supabase.service
      .from('referee_qualifications')
      .select('person_id')
      .eq('event_id', eventId);
    if (error) throw new BadRequestException(error.message);
    return (data ?? []) as Array<{ person_id: string }>;
  }

  /** Pistes configured for the event. Readiness only needs how many. */
  private async countEventLices(eventId: string): Promise<number> {
    const { data, error } = await this.supabase.service
      .from('lices')
      .select('id')
      .eq('event_id', eventId);
    if (error) throw new BadRequestException(error.message);
    return ((data ?? []) as Array<{ id: string }>).length;
  }

  private async getPoolsForPhases(phaseIds: string[]) {
    if (phaseIds.length === 0) return [] as Array<{ id: string; phase_id: string }>;
    const { data, error } = await this.supabase.service
      .from('pools')
      .select('id, phase_id')
      .in('phase_id', phaseIds);
    if (error) throw new BadRequestException(error.message);
    return (data ?? []) as Array<{ id: string; phase_id: string }>;
  }

  /** Swiss rounds generated so far, for the readiness snapshot. */
  private async getSwissRoundsForPhases(phaseIds: string[]) {
    if (phaseIds.length === 0) return [] as Array<{ id: string; phase_id: string }>;
    const { data, error } = await this.supabase.service
      .from('swiss_rounds')
      .select('id, phase_id')
      .in('phase_id', phaseIds);
    if (error) throw new BadRequestException(error.message);
    return (data ?? []) as Array<{ id: string; phase_id: string }>;
  }

  /**
   * Matches of the given phases with just their scheduling coordinates. A
   * match is scheduled only with BOTH `lice_id` and `scheduled_at` — either
   * alone cannot be placed on the board — which is the same predicate the
   * organizer chat's unscheduled-match tool uses.
   */
  private async getMatchScheduleRowsForPhases(phaseIds: string[]) {
    type Row = {
      id: string;
      pool_id: string | null;
      lice_id: string | null;
      scheduled_at: string | null;
    };
    if (phaseIds.length === 0) return [] as Row[];
    const { data, error } = await this.supabase.service
      .from('matches')
      .select('id, pool_id, lice_id, scheduled_at')
      .in('phase_id', phaseIds);
    if (error) throw new BadRequestException(error.message);
    return (data ?? []) as Row[];
  }

  /**
   * Referee assignments that still stand for the event, pool- or match-scoped.
   * The status filter mirrors the public pool footer: a declined or cancelled
   * row is not cover. Lice-scoped rows are excluded — they staff a piste for a
   * span of time, not a specific pool, so they cannot answer "is this pool
   * refereed".
   */
  private async getLiveRefereeAssignmentScopes(eventId: string) {
    const { data, error } = await this.supabase.service
      .from('referee_assignments')
      .select('pool_id, match_id')
      .eq('event_id', eventId)
      .in('scope_type', ['pool', 'match'])
      .in('status', ['assigned', 'confirmed', 'pending']);
    if (error) throw new BadRequestException(error.message);
    return (data ?? []) as Array<{ pool_id: string | null; match_id: string | null }>;
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

    // 2b. Per-pool lice + start time, derived from the pool's matches — drives
    //     the public Pool List's start-time sections + per-card piste badge.
    const scheduleByPool = new Map<string, ReturnType<typeof derivePoolSchedule>>();
    if (poolIds.length > 0) {
      const { data: matchTimeData } = await this.supabase.service
        .from('matches')
        .select('pool_id, scheduled_at, lices(name, color_hex)')
        .in('pool_id', poolIds);
      const byPool = new Map<string, PoolMatchTimeRow[]>();
      for (const row of (matchTimeData ?? []) as unknown as Array<
        PoolMatchTimeRow & { pool_id: string | null }
      >) {
        if (!row.pool_id) continue;
        const list = byPool.get(row.pool_id) ?? [];
        list.push({ scheduled_at: row.scheduled_at, lices: row.lices });
        byPool.set(row.pool_id, list);
      }
      for (const id of poolIds) {
        scheduleByPool.set(id, derivePoolSchedule(byPool.get(id) ?? []));
      }
    }

    // 3. Compose the public payload. `standings` stays empty here —
    //    the public tournament page hydrates per-pool standings via
    //    Realtime / a dedicated endpoint.
    return poolRows.map((pool) => ({
      id: pool.id,
      name: pool.name,
      liceName: scheduleByPool.get(pool.id)?.liceName ?? null,
      liceColorHex: scheduleByPool.get(pool.id)?.liceColorHex ?? null,
      startAt: scheduleByPool.get(pool.id)?.startAt ?? null,
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

    const { nameById, colorById } = await this.resolveRefereeChipMaps(rows);

    for (const r of rows) {
      if (!r.pool_id) continue;
      const displayName = r.person_id ? (nameById.get(r.person_id) ?? '—') : '—';
      const skillColor = r.role ? (colorById.get(r.role) ?? 'slate') : 'slate';
      const list = byPool.get(r.pool_id) ?? [];
      list.push({ role: r.role, displayName, status: r.status, skillColor });
      byPool.set(r.pool_id, list);
    }
    return byPool;
  }

  /**
   * Shared referee-chip resolution for the public pool + bracket footers:
   * display names via global_persons (given+family) and skill colours via
   * referee_skills.color. Post-0063 `referee_assignments.person_id` is NOT
   * NULL, so every row resolves through the single global_persons lookup —
   * no Supabase-user-id fallback. `role` carries the referee_skills.id string
   * (e.g. 'arbitre_assesseur') → the colour token used to tint the chip.
   */
  private async resolveRefereeChipMaps(
    rows: Array<{ role: string | null; person_id: string | null }>,
  ): Promise<{ nameById: Map<string, string>; colorById: Map<string, string> }> {
    const nameById = new Map<string, string>();
    const colorById = new Map<string, string>();

    const personIds = Array.from(
      new Set(rows.map((r) => r.person_id).filter((id): id is string => !!id)),
    );
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
        if (name) nameById.set(p.id, name);
      }
    }

    const skillIds = Array.from(new Set(rows.map((r) => r.role).filter((r): r is string => !!r)));
    if (skillIds.length > 0) {
      const { data: skillRows } = await this.supabase.service
        .from('referee_skills')
        .select('id, color')
        .in('id', skillIds);
      for (const s of (skillRows ?? []) as Array<{ id: string; color: string | null }>) {
        if (s.color) colorById.set(s.id, s.color);
      }
    }

    return { nameById, colorById };
  }

  /**
   * For each bracket match, return the confirmed + pending referee slots
   * (scope_type='match') projected for public consumption — the mirror of
   * getPublishedRefereesByPool, keyed by match_id. Never exposes admin-only
   * signals (auto_assigned / conflicts_jsonb / candidate suggestions).
   */
  private async getPublishedRefereesByMatch(
    eventId: string,
    matchIds: string[],
  ): Promise<
    Map<
      string,
      Array<{ role: string | null; displayName: string; status: string; skillColor: string }>
    >
  > {
    const byMatch = new Map<
      string,
      Array<{ role: string | null; displayName: string; status: string; skillColor: string }>
    >();
    if (matchIds.length === 0) return byMatch;

    const { data: assignments, error } = await this.supabase.service
      .from('referee_assignments')
      .select('match_id, role, status, person_id')
      .eq('event_id', eventId)
      .eq('scope_type', 'match')
      .in('match_id', matchIds)
      .in('status', ['assigned', 'confirmed', 'pending']);
    if (error) throw new BadRequestException(error.message);

    const rows = (assignments ?? []) as Array<{
      match_id: string | null;
      role: string | null;
      status: string;
      person_id: string | null;
    }>;
    if (rows.length === 0) return byMatch;

    const { nameById, colorById } = await this.resolveRefereeChipMaps(rows);

    for (const r of rows) {
      if (!r.match_id) continue;
      const displayName = r.person_id ? (nameById.get(r.person_id) ?? '—') : '—';
      const skillColor = r.role ? (colorById.get(r.role) ?? 'slate') : 'slate';
      const list = byMatch.get(r.match_id) ?? [];
      list.push({ role: r.role, displayName, status: r.status, skillColor });
      byMatch.set(r.match_id, list);
    }
    return byMatch;
  }

  private async getPublishedBracket(phase: Record<string, unknown>, eventId: string) {
    const phaseId = phase['id'] as string;
    const { data, error } = await this.supabase.service
      .from('bracket_slots')
      .select(
        'id, round, position, source_a_ref, source_b_ref, registration_a_id, registration_b_id',
      )
      .eq('phase_id', phaseId)
      .order('round', { ascending: true });
    if (error) throw new BadRequestException(error.message);

    type RawSlot = {
      id: string;
      round: number;
      position: number;
      source_a_ref: string | null;
      source_b_ref: string | null;
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
        winner_registration_id: string | null;
        match_number_label: string | null;
        liceName: string | null;
      }
    >();
    if (slotIds.length > 0) {
      const { data: matchRows } = await this.supabase.service
        .from('matches')
        .select(
          'id, bracket_slot_id, status, red_score, blue_score, winner_registration_id, match_number_label, lice_id, lices(name)',
        )
        .in('bracket_slot_id', slotIds);
      for (const m of (matchRows ?? []) as unknown as Array<{
        id: string;
        bracket_slot_id: string;
        status: string;
        red_score: number | null;
        blue_score: number | null;
        winner_registration_id: string | null;
        match_number_label: string | null;
        lices: { name: string | null } | null;
      }>) {
        matchBySlot.set(m.bracket_slot_id, {
          id: m.id,
          status: m.status,
          red_score: m.red_score,
          blue_score: m.blue_score,
          winner_registration_id: m.winner_registration_id,
          match_number_label: m.match_number_label,
          liceName: m.lices?.name ?? null,
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

    // Referees per bracket match (scope_type='match'), mirroring the pool footer.
    const matchIds = Array.from(new Set(Array.from(matchBySlot.values()).map((m) => m.id)));
    const refereesByMatch = await this.getPublishedRefereesByMatch(eventId, matchIds);

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
        // Forfeits can complete a match with the lower score winning — the
        // final ranking must read the recorded winner, not compare scores.
        winnerRegistrationId: match?.winner_registration_id ?? null,
        status: match?.status ?? 'scheduled',
        matchId: match?.id ?? null,
        redRegistrationId: s.registration_a_id,
        blueRegistrationId: s.registration_b_id,
        source_a_ref: s.source_a_ref,
        source_b_ref: s.source_b_ref,
        liceName: match?.liceName ?? null,
        referees: match?.id ? (refereesByMatch.get(match.id) ?? []) : [],
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
      // Shape, so the public bracket renders double-elim as WB/LB/GF lanes and
      // ranks it by losers-bracket exit rather than by first loss. The podium
      // fields matter for the SAME reason: in bronze mode gold and silver come
      // from the winners-bracket final, and with a repechage cutoff the
      // pre-cutoff winners-bracket losers ARE eliminated on one loss.
      phaseType:
        phase['type'] === 'double_elim' ? ('double_elim' as const) : ('single_elim' as const),
      wbRounds: config['wbRounds'] === undefined ? null : Number(config['wbRounds']),
      lbRounds: config['lbRounds'] === undefined ? null : Number(config['lbRounds']),
      // Defaults reproduce the classical bracket that phases predating these
      // options were generated as.
      secondChanceTarget:
        config['secondChanceTarget'] === 'bronze' ? ('bronze' as const) : ('gold' as const),
      bronzeMatch: config['bronzeMatch'] === undefined ? null : Boolean(config['bronzeMatch']),
      repechageEntryRound:
        config['repechageEntryRound'] === undefined ? null : Number(config['repechageEntryRound']),
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
    const rulesetDefaults = await resolveRulesetConfigDefaults(this.supabase, code, version);
    // An explicit caller override wins, merged onto the defaults exactly the
    // way updateTournament's ruleset-switch branch merges one. `rulesetConfig`
    // was accepted by the create DTO and then silently discarded, so a caller
    // pinning e.g. matchFormat.pointCap at creation watched it vanish — the
    // same bug its sibling `scoringConfig` was fixed for on the line below.
    //
    // Validated ONLY when an override is present. The defaults alone are stored
    // unvalidated today, and a custom ruleset can seed a partial config that the
    // strict schema rejects (see the backfill note in updateTournament), so
    // parsing them here would newly 400 creates that work today.
    const rulesetConfig = dto.rulesetConfig
      ? validateTournamentRulesetConfig(code, deepMergeJson(rulesetDefaults, dto.rulesetConfig))
      : rulesetDefaults;

    // Seed scoring_config_json from the ruleset's grammar, so the referee's pad
    // reflects the ruleset a federation actually chose instead of FFAMHE's
    // +2/+1 hardcoded default. Until now the column stayed NULL until a PATCH,
    // and `GET /match-config` substituted DEFAULT_SCORING_CONFIG for NULL — so
    // a ruleset scoring head/torso/limb still got the two federal buttons.
    const grammar = await resolveRulesetGrammar(this.supabase, code, version);
    // An explicit caller override still wins, merged the way a PATCH merges —
    // this stops the create DTO's `scoringConfig` being the silently-dropped
    // field it is today. Normalize once, so the stored blob is byte-identical
    // to what every other write path produces.
    const scoringConfig = normalizeTournamentScoringConfig(
      deepMergeJson(buildSeededScoringConfig(grammar, rulesetConfig), dto.scoringConfig ?? {}),
    );

    // Strict catalog-only weapon: a non-empty value must resolve to an active
    // weapon_catalog entry (throws 400 otherwise); the canonical name is stored.
    const weapon = dto.weapon?.trim()
      ? await resolveCatalogWeapon(this.supabase.service, dto.weapon)
      : null;

    // Pin the penalty ruleset's current version so the content-hash reads the
    // frozen snapshot for exactly what was pinned.
    const penaltyRulesetVersion = dto.penaltyRulesetId
      ? await loadPenaltyRulesetVersion(this.supabase, dto.penaltyRulesetId)
      : null;

    const { data, error } = await this.supabase.service
      .from('tournaments')
      .insert({
        event_id: eventId,
        slug: dto.slug,
        name: dto.name.trim(),
        weapon,
        ruleset_code: code,
        // Persist the registry-canonical version ('1' -> '1.0.0'), not the raw
        // shorthand: the @myclash/rulesets registry keys built-ins as
        // `${code}@1.0.0`, and downstream reads (e.g. pool-standings) look the
        // ruleset up by this stored version with no normalization of their own.
        ruleset_version: version,
        penalty_ruleset_id: dto.penaltyRulesetId ?? null,
        penalty_ruleset_version: penaltyRulesetVersion,
        color: dto.color ?? null,
        // Capacity caps from the wizard's Step 1 Basics. Null
        // (or omitted) = no cap, same semantics as the settings
        // page's UpdateTournamentDto path.
        max_participants: dto.maxParticipants ?? null,
        max_waitlist: dto.maxWaitlist ?? null,
        status: 'draft',
        ruleset_config: rulesetConfig,
        scoring_config_json: scoringConfig,
        // Step 1 is complete by definition once the row exists.
        wizard_step: 1,
      })
      .select('*')
      .single();

    if (error) throw new BadRequestException(error.message);

    // Pin the ruleset version: subsequent edits to (code, version) must
    // bump a new version instead of mutating in place. Freeze on the same
    // canonical version we stored above (a no-op for system rulesets).
    await freezeRulesetVersion(this.supabase, code, version);
    // Pin the penalty ruleset too: snapshot + freeze its current version so the
    // pinned definition is captured immutably (best-effort; no-op for the
    // built-in). Immutability itself is enforced by the penalties edit-guard.
    if (dto.penaltyRulesetId) {
      await freezePenaltyRulesetVersion(this.supabase, dto.penaltyRulesetId, userId);
    }
    // Stamp the tournament's effective content-hash identity (matches copy it at
    // generation). After the penalty freeze so the pinned snapshot exists.
    await this.stampTournamentContentHash((data as { id: string }).id);

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

    // Enrich with the ruleset's own grammar so admin surfaces stop asking
    // `rulesetCode === 'TF_v1'` to decide whether to offer afterblow controls.
    // That literal hid the controls from every custom ruleset that HAS
    // afterblow, and showed them for a ruleset that does not.
    const row = data as { ruleset_code?: string | null; ruleset_version?: string | null };
    const code = row.ruleset_code ?? 'TF_v1';
    const version = normalizeRulesetVersion(row.ruleset_version ?? '1');
    const grammar = await resolveRulesetGrammar(this.supabase, code, version);
    // Whether the tournament points at the LOCKED built-in format (grey the
    // coded controls + offer "Customise this format") or at a base_code fork of
    // one (the controls are the org's to edit). ruleset_base_code is the coded
    // algorithm a fork reuses, so the admin UI knows a fork of TF_v1 still owns
    // winBonus/targets even though its code is no longer 'TF_v1'.
    const isSystem = isSystemRuleset(code, version);
    let baseCode: string | null = null;
    if (!isSystem) {
      const { data: rs } = await this.supabase.service
        .from('custom_rulesets')
        .select('base_code')
        .eq('code', code)
        .maybeSingle();
      baseCode = (rs as { base_code: string | null } | null)?.base_code ?? null;
    }
    return {
      ...(data as Record<string, unknown>),
      ruleset_grammar: grammar,
      ruleset_is_system: isSystem,
      ruleset_base_code: baseCode,
    };
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
    if (dto.weapon !== undefined) {
      const submitted = dto.weapon?.trim() ?? '';
      const currentWeapon = String(currentJson['weapon'] ?? '').trim();
      if (!submitted) {
        updates['weapon'] = null;
      } else if (submitted === currentWeapon) {
        // Legacy escape hatch: an unchanged value is accepted even if it's not
        // in the catalog, so editing a tournament whose weapon predates the
        // catalog (or was later deactivated) never 400s on unrelated saves.
        updates['weapon'] = currentJson['weapon'];
      } else {
        updates['weapon'] = await resolveCatalogWeapon(this.supabase.service, submitted);
      }
    }
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

    // Monotonic: the operator can jump back and re-save an earlier step, and
    // that must not un-complete the later ones. Recorded rather than inferred —
    // every blob the old heuristic read is written by the server itself.
    if (dto.wizardStep !== undefined) {
      const current = currentJson['wizard_step'];
      const previous = typeof current === 'number' ? current : 0;
      updates['wizard_step'] = Math.max(previous, dto.wizardStep);
    }
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
      // Guard the score-changing swap. Standings resolve the tournament's LIVE
      // ruleset pointer at read time (pool-standings.service.ts), so switching
      // ruleset once matches are scored silently re-ranks recorded results.
      // An ordinary settings PATCH must never do that: a mid-event ruleset
      // change has to go through the audited re-pin flow (typed confirmation +
      // justification + public disclosure). The score-preserving "Customise
      // this format" fork re-points via repointTournamentToRuleset, not here,
      // so it is intentionally unaffected.
      await this.assertNoRecordedResults(
        [tournamentId],
        'This tournament has scored matches, so its ruleset is locked to ordinary edits. Re-pin it through the audited change flow instead.',
      );
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

    // Penalty re-pin guard: the same posture as the scoring swap above. Recorded
    // penalties are denormalised (past cards keep their effect), but swapping the
    // penalty ruleset once matches are scored would apply a different sanction
    // ladder/cost to later cards than the ones already recorded — lock it to
    // pre-scoring edits.
    const currentPenaltyRulesetId = (currentJson['penalty_ruleset_id'] as string | null) ?? null;
    const nextPenaltyRulesetId =
      dto.penaltyRulesetId !== undefined ? (dto.penaltyRulesetId ?? null) : currentPenaltyRulesetId;
    const penaltyChanged = nextPenaltyRulesetId !== currentPenaltyRulesetId;
    if (penaltyChanged) {
      await this.assertNoRecordedResults(
        [tournamentId],
        'This tournament has scored matches, so its penalty ruleset is locked. Change it before scoring starts.',
      );
      // Re-pin the penalty version so the content-hash tracks the new snapshot.
      updates['penalty_ruleset_version'] = nextPenaltyRulesetId
        ? await loadPenaltyRulesetVersion(this.supabase, nextPenaltyRulesetId)
        : null;
    }

    const { data, error } = await this.supabase.service
      .from('tournaments')
      .update(updates)
      .eq('id', tournamentId)
      .select('*')
      .single();

    if (error) throw new BadRequestException(error.message);
    // Freeze the newly-pinned penalty ruleset's current version (best-effort).
    if (penaltyChanged && nextPenaltyRulesetId) {
      await freezePenaltyRulesetVersion(this.supabase, nextPenaltyRulesetId, userId);
    }
    // Restamp the content hash when anything score-determining changed.
    if (
      codeChanged ||
      versionChanged ||
      penaltyChanged ||
      dto.rulesetConfig !== undefined ||
      dto.scoringConfig !== undefined
    ) {
      await this.stampTournamentContentHash(tournamentId);
    }
    if (dto.status === 'completed') {
      await this.notificationEvents.resultsPublished(tournamentId);
    }
    return data;
  }

  /**
   * "Customise this format": fork the built-in ruleset this tournament points at
   * into a PRIVATE, org-owned coded ruleset, then re-point the tournament to it.
   *
   * The fork reuses the built-in's coded algorithm (base_code) with the
   * tournament's CURRENT config captured as its tf_config, so re-pointing is
   * byte-identical scoring — ruleset_config and scoring_config_json are left
   * untouched. What changes is ownership: the format is now the org's to edit,
   * so the locked winBonus/target controls unlock. No results guard is needed
   * because the operation does not change any score.
   */
  async forkCodedRulesetForTournament(tournamentId: string, userId: string) {
    const { data: current, error: readError } = await this.supabase.service
      .from('tournaments')
      .select('*')
      .eq('id', tournamentId)
      .maybeSingle();
    if (readError) throw new BadRequestException(readError.message);
    if (!current) throw new NotFoundException(`Tournament ${tournamentId} not found`);

    const row = current as Record<string, unknown>;
    const event = await this.getEventById(row['event_id'] as string);
    const orgId = (event as { organization_id: string }).organization_id;
    await this.orgs.assertOrgRole(orgId, userId, 'admin');

    const code = (row['ruleset_code'] as string | null) ?? 'TF_v1';
    const version = normalizeRulesetVersion((row['ruleset_version'] as string | null) ?? '1');
    if (!isSystemRuleset(code, version)) {
      throw new BadRequestException(
        'Only a built-in format can be customised this way. This tournament already uses a custom ruleset — edit it directly.',
      );
    }

    const fork = await this.createCodedFork(row, code, version, orgId, userId);
    // Re-point only the pointer. Scoring is byte-identical (same engine, same
    // config), so ruleset_config and scoring_config_json are left untouched. A
    // failed re-point leaves an unreferenced private fork — harmless.
    const updated = await this.repointTournamentToRuleset(
      tournamentId,
      String(fork['code']),
      '1.0.0',
    );
    await this.writeForkAudit(userId, tournamentId, {
      orgId,
      fromCode: code,
      fromVersion: version,
      toCode: fork['code'],
      forkId: fork['id'],
    });
    return { ruleset: fork, tournament: updated };
  }

  /**
   * Build and insert the private coded fork for `tournamentRow`, capturing its
   * current ruleset_config as the fork's tf_config and its grammar as columns.
   */
  private async createCodedFork(
    tournamentRow: Record<string, unknown>,
    code: string,
    version: string,
    orgId: string,
    userId: string,
  ): Promise<Record<string, unknown>> {
    const grammar = await resolveRulesetGrammar(this.supabase, code, version);
    const forkCode = `custom_${code.toLowerCase()}_fork_${Date.now().toString(36)}`;
    const forkRow = buildCodedForkRow({
      code: forkCode,
      baseCode: code,
      baseVersion: version,
      name: `${await this.systemRulesetName(code)} (customised)`,
      ownerOrganizationId: orgId,
      actorUserId: userId,
      tfConfig: (tournamentRow['ruleset_config'] as Record<string, unknown>) ?? {},
      grammar,
    });
    const { data: fork, error } = await this.supabase.service
      .from('custom_rulesets')
      .insert(forkRow)
      .select('*')
      .single();
    if (error || !fork) {
      if (error?.message?.includes('unique'))
        throw new ConflictException(`Ruleset code "${forkCode}" already exists`);
      throw new BadRequestException(error?.message ?? 'Fork failed');
    }
    return fork as Record<string, unknown>;
  }

  /** Re-point a tournament to a (code, version) without touching its config. */
  private async repointTournamentToRuleset(
    tournamentId: string,
    code: string,
    version: string,
  ): Promise<Record<string, unknown>> {
    const { data, error } = await this.supabase.service
      .from('tournaments')
      .update({
        ruleset_code: code,
        ruleset_version: version,
        updated_at: new Date().toISOString(),
      })
      .eq('id', tournamentId)
      .select('*')
      .single();
    if (error || !data) throw new BadRequestException(error?.message ?? 'Re-point failed');
    return data as Record<string, unknown>;
  }

  /** Display name of a built-in ruleset's mirror row, for naming its fork. */
  private async systemRulesetName(code: string): Promise<string> {
    const { data } = await this.supabase.service
      .from('custom_rulesets')
      .select('name')
      .eq('code', code)
      .eq('is_system', true)
      .maybeSingle();
    return (data as { name: string } | null)?.name ?? code;
  }

  /** Best-effort append to audit_log; a fork must not fail because logging did. */
  private async writeForkAudit(
    actorUserId: string,
    tournamentId: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    try {
      await insertAuditLog(this.supabase.service, {
        actorUserId: actorUserId === 'unknown' ? null : actorUserId,
        action: 'tournament.ruleset.fork',
        entityType: 'tournament',
        entityId: tournamentId,
        payload,
      });
    } catch {
      // swallow — the fork + re-point are the source of truth
    }
  }

  /**
   * Mid-event ruleset RE-PIN: the audited path for changing a tournament's
   * ruleset after results exist (the ordinary PATCH is blocked once matches are
   * scored). Org-owner or platform super-admin only; completed/archived
   * tournaments are hard-blocked. Records an append-only audit — from->to,
   * per-bucket diff, justification, before/after placings — that the public
   * event page discloses.
   */
  async repinTournamentRuleset(
    tournamentId: string,
    dto: RepinTournamentRulesetDto,
    userId: string,
  ) {
    const { data: current, error: readError } = await this.supabase.service
      .from('tournaments')
      .select('*')
      .eq('id', tournamentId)
      .maybeSingle();
    if (readError) throw new BadRequestException(readError.message);
    if (!current) throw new NotFoundException(`Tournament ${tournamentId} not found`);

    const row = current as Record<string, unknown>;
    const event = await this.getEventById(row['event_id'] as string);
    const orgId = (event as { organization_id: string }).organization_id;
    await this.assertOwnerOrSuperAdmin(orgId, userId);

    const status = String(row['status'] ?? '');
    if (status === 'completed' || status === 'archived') {
      throw new ForbiddenException(
        'A completed or archived tournament cannot be re-pinned — its results are final.',
      );
    }

    const fromCode = (row['ruleset_code'] as string | null) ?? 'TF_v1';
    const fromVersion = normalizeRulesetVersion((row['ruleset_version'] as string | null) ?? '1');
    const toCode = dto.rulesetCode;
    const toVersion = normalizeRulesetVersion(dto.rulesetVersion ?? '1.0.0');
    if (toCode === fromCode && toVersion === fromVersion) {
      throw new BadRequestException('The tournament already uses this ruleset.');
    }

    // Reject a target that will NOT resolve for scoring/standings before any
    // mutation. resolveRulesetConfigDefaults + validateTournamentRulesetConfig
    // will happily reseed a TF-shaped config for an unknown/typo code or a
    // still-draft custom ruleset, the re-point would commit, and then every
    // standings read 400s (the after-snapshot's resolver error is swallowed) —
    // a live tournament silently bricked behind a 200. The fork path guards its
    // precondition the same way (isSystemRuleset).
    if (!this.rulesetResolver) {
      throw new BadRequestException('Ruleset resolver unavailable; cannot re-pin.');
    }
    if (!(await this.rulesetResolver.resolve(toCode, toVersion))) {
      throw new BadRequestException(
        `The selected ruleset (${toCode} ${toVersion}) is not available to re-pin to — publish it first.`,
      );
    }

    const oldConfig = (row['ruleset_config'] as Record<string, unknown>) ?? {};
    const newDefaults = await resolveRulesetConfigDefaults(this.supabase, toCode, toVersion);
    const diff = await this.computeRulesetBucketDiff(
      { code: fromCode, version: fromVersion, config: oldConfig },
      { code: toCode, version: toVersion, config: newDefaults },
    );

    // Order matters: snapshot on the OLD pointer, re-point, snapshot on the NEW
    // pointer, then record. The audit insert throws — an unaudited re-pin must
    // not silently happen.
    const before = await this.snapshotPlacings(tournamentId);
    const updated = await this.repointAndReseed(tournamentId, toCode, toVersion, newDefaults);
    const after = await this.snapshotPlacings(tournamentId);
    await this.writeRepinAudit({
      eventId: row['event_id'] as string,
      tournamentId,
      actorUserId: userId,
      fromCode,
      fromVersion,
      toCode,
      toVersion,
      justification: dto.justification,
      diff,
      before,
      after,
    });
    // Restamp the tournament's current hash. Already-generated matches keep their
    // generation-time hash, so match.hash != tournament.hash now signals the
    // re-pin drift (which the public event page also discloses).
    await this.stampTournamentContentHash(tournamentId);
    return { tournament: updated, rulesetChange: { fromCode, toCode, diff } };
  }

  /**
   * Read-only preview of the per-bucket lineage diff a re-pin to
   * (rulesetCode, rulesetVersion) WOULD produce — the same computation as
   * {@link repinTournamentRuleset} minus every mutation, so the ceremony can show
   * the lamps BEFORE the organiser confirms. Same owner/super-admin gate, and the
   * same reject-unresolvable-target guard, so a bogus diff is never previewed.
   */
  async previewRepinBucketDiff(
    tournamentId: string,
    dto: { rulesetCode: string; rulesetVersion?: string },
    userId: string,
  ): Promise<{ fromCode: string; toCode: string; diff: BucketDiff }> {
    const { data: current, error: readError } = await this.supabase.service
      .from('tournaments')
      .select('ruleset_code, ruleset_version, ruleset_config, event_id')
      .eq('id', tournamentId)
      .maybeSingle();
    if (readError) throw new BadRequestException(readError.message);
    if (!current) throw new NotFoundException(`Tournament ${tournamentId} not found`);

    const row = current as Record<string, unknown>;
    const event = await this.getEventById(row['event_id'] as string);
    const orgId = (event as { organization_id: string }).organization_id;
    await this.assertOwnerOrSuperAdmin(orgId, userId);

    const fromCode = (row['ruleset_code'] as string | null) ?? 'TF_v1';
    const fromVersion = normalizeRulesetVersion((row['ruleset_version'] as string | null) ?? '1');
    const toCode = dto.rulesetCode;
    const toVersion = normalizeRulesetVersion(dto.rulesetVersion ?? '1.0.0');

    if (!this.rulesetResolver || !(await this.rulesetResolver.resolve(toCode, toVersion))) {
      throw new BadRequestException(
        `The selected ruleset (${toCode} ${toVersion}) is not available to re-pin to — publish it first.`,
      );
    }

    const oldConfig = (row['ruleset_config'] as Record<string, unknown>) ?? {};
    const newDefaults = await resolveRulesetConfigDefaults(this.supabase, toCode, toVersion);
    const diff = await this.computeRulesetBucketDiff(
      { code: fromCode, version: fromVersion, config: oldConfig },
      { code: toCode, version: toVersion, config: newDefaults },
    );
    return { fromCode, toCode, diff };
  }

  /** Re-pin authorization: platform super-admin, or the org's owner. */
  private async assertOwnerOrSuperAdmin(orgId: string, userId: string): Promise<void> {
    if (await this.isSuperAdmin(userId)) return;
    await this.orgs.assertOrgRole(orgId, userId, 'owner');
  }

  /**
   * `super_admin`-EXACT. Re-pinning rewrites how a live or completed
   * tournament's results are computed, overriding the org's own owner — a
   * data-integrity override, not moderation, so it stays in the reserve.
   */
  private async isSuperAdmin(userId: string): Promise<boolean> {
    return hasPlatformTier(this.supabase, userId, 'super_admin');
  }

  /**
   * Per-bucket diff (grammar / end-conditions / ranking) of the NEW ruleset vs
   * the OLD — COMPUTED from each side's grammar + config, never self-declared.
   *
   * The config comes from the CALLER here (the tournament's own stored config on
   * the from-side, the target's freshly resolved defaults on the to-side), which
   * is why this projects the pair itself instead of calling `bucketInputsForCode`
   * — a re-pin compares what the tournament actually runs, not what its ruleset
   * would default to. The projection is otherwise the shared one, so a re-pin's
   * lamps and a ruleset list's lamps stay the same computation.
   */
  private async computeRulesetBucketDiff(
    from: { code: string; version: string; config: Record<string, unknown> },
    to: { code: string; version: string; config: Record<string, unknown> },
  ): Promise<BucketDiff> {
    const [fromInputs, toInputs] = await Promise.all([
      this.projectPinnedBuckets(from),
      this.projectPinnedBuckets(to),
    ]);
    return diffRulesetBuckets(fromInputs, toInputs);
  }

  /** One side of a re-pin diff: the ruleset's resolved grammar carrying the
   *  config the tournament actually runs with. */
  private async projectPinnedBuckets(pin: {
    code: string;
    version: string;
    config: Record<string, unknown>;
  }): Promise<RulesetBucketInputs> {
    const grammar = await resolveRulesetGrammar(this.supabase, pin.code, pin.version);
    return projectRulesetBuckets({
      targets: grammar.targets,
      has_afterblow: grammar.hasAfterblow,
      afterblow_valuation: grammar.afterblowValuation,
      afterblow_fixed_value: grammar.afterblowFixedValue,
      tf_config: pin.config,
    });
  }

  /**
   * Materialise the overall standings (placings + scores) so the audit's
   * before/after survives later match edits. A tournament that cannot yet
   * produce standings records an empty snapshot rather than failing the re-pin.
   */
  private async snapshotPlacings(tournamentId: string): Promise<Array<Record<string, unknown>>> {
    if (!this.poolStandings) {
      throw new BadRequestException('Standings service unavailable; cannot audit a re-pin.');
    }
    try {
      const standings = await this.poolStandings.getPoolStandings(tournamentId, 'overall');
      const rows = 'rows' in standings ? standings.rows : [];
      return rows.map((r) => ({
        rank: r.rank,
        registrationId: r.registrationId,
        displayName: r.displayName,
        stats: r.stats,
      }));
    } catch {
      return [];
    }
  }

  /** Re-point + reseed ruleset_config from the new ruleset's defaults (the
   *  score-changing swap, mirroring updateTournament's ruleset-change branch). */
  private async repointAndReseed(
    tournamentId: string,
    toCode: string,
    toVersion: string,
    newDefaults: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const rulesetConfig = validateTournamentRulesetConfig(toCode, newDefaults);
    const { data, error } = await this.supabase.service
      .from('tournaments')
      .update({
        ruleset_code: toCode,
        ruleset_version: toVersion,
        ruleset_config: rulesetConfig,
        updated_at: new Date().toISOString(),
      })
      .eq('id', tournamentId)
      .select('*')
      .single();
    if (error || !data) throw new BadRequestException(error?.message ?? 'Re-pin failed');
    return data as Record<string, unknown>;
  }

  /** Append the re-pin to its audit table (throws — the audit IS the ceremony)
   *  and mirror a generic audit_log row for the super-admin trail (best-effort). */
  private async writeRepinAudit(a: {
    eventId: string;
    tournamentId: string;
    actorUserId: string;
    fromCode: string;
    fromVersion: string;
    toCode: string;
    toVersion: string;
    justification: string;
    diff: BucketDiff;
    before: Array<Record<string, unknown>>;
    after: Array<Record<string, unknown>>;
  }): Promise<void> {
    const actor = a.actorUserId === 'unknown' ? null : a.actorUserId;
    const { error } = await this.supabase.service.from('tournament_ruleset_repins').insert({
      event_id: a.eventId,
      tournament_id: a.tournamentId,
      actor_user_id: actor,
      from_code: a.fromCode,
      from_version: a.fromVersion,
      to_code: a.toCode,
      to_version: a.toVersion,
      justification: a.justification,
      bucket_diff: a.diff,
      ranking_compatible: a.diff.rankingCompatible,
      placings_before: a.before,
      placings_after: a.after,
    });
    if (error) throw new BadRequestException(`Re-pin audit failed: ${error.message}`);
    try {
      await insertAuditLog(this.supabase.service, {
        actorUserId: actor,
        action: 'tournament.ruleset.repin',
        entityType: 'tournament',
        entityId: a.tournamentId,
        payload: {
          eventId: a.eventId,
          fromCode: a.fromCode,
          fromVersion: a.fromVersion,
          toCode: a.toCode,
          toVersion: a.toVersion,
          rankingCompatible: a.diff.rankingCompatible,
        },
      });
    } catch {
      // swallow — tournament_ruleset_repins is the source of truth
    }
  }

  /**
   * The latest audited ruleset re-pin for a tournament, projected for PUBLIC
   * disclosure on the event page: what changed (human labels), the organiser's
   * reason, and whether rankings were affected. Null when never re-pinned.
   * Read server-side (service_role) — the audit table is not anon-readable, so
   * the API is the disclosure surface.
   */
  private async loadLatestRulesetRepin(
    tournamentId: string,
  ): Promise<Record<string, unknown> | null> {
    const { data } = await this.supabase.service
      .from('tournament_ruleset_repins')
      .select(
        'from_code, from_version, to_code, to_version, justification, ranking_compatible, bucket_diff, created_at',
      )
      .eq('tournament_id', tournamentId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!data) return null;
    const row = data as {
      from_code: string;
      from_version: string;
      to_code: string;
      to_version: string;
      justification: string;
      ranking_compatible: boolean;
      bucket_diff: BucketDiff | null;
      created_at: string;
    };
    const [fromLabel, toLabel] = await Promise.all([
      resolveRulesetLabel(this.supabase, row.from_code, row.from_version),
      resolveRulesetLabel(this.supabase, row.to_code, row.to_version),
    ]);
    return {
      changedAt: row.created_at,
      fromLabel,
      toLabel,
      justification: row.justification,
      rankingCompatible: row.ranking_compatible,
      // The materialised per-bucket diff (grammar/end-conditions/ranking) so the
      // public page can show WHICH buckets changed, not just the boolean.
      bucketDiff: row.bucket_diff ?? null,
    };
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

    // For draft/published: block if any match has a recorded result.
    await this.assertNoRecordedResults(
      [tournamentId],
      'This tournament has scored matches. Submit a deletion request.',
    );

    const event = await this.getEventById((row as { event_id: string }).event_id);
    await this.orgs.assertOrgRole(
      (event as { organization_id: string }).organization_id,
      userId,
      'admin',
    );
    // Clear the RESTRICT-protected result graph (forfeits → matches →
    // registrations) before the cascade delete, else the bare tournaments
    // delete aborts on matches.*_registration_id.
    await this.clearTournamentResultGraph([tournamentId]);
    const { error } = await this.supabase.service
      .from('tournaments')
      .delete()
      .eq('id', tournamentId);
    if (error) throw new BadRequestException(error.message);
    return { id: tournamentId };
  }

  /**
   * Refuse a hard delete when any match in the given tournaments has progressed
   * past `scheduled` (i.e. has a recorded result). Generated-but-unplayed
   * schedules (all `scheduled`) are safe to tear down — that's the common
   * "delete my test event" case.
   */
  private async assertNoRecordedResults(tournamentIds: string[], message: string): Promise<void> {
    if (tournamentIds.length === 0) return;
    const { data: phases } = await this.supabase.service
      .from('phases')
      .select('id')
      .in('tournament_id', tournamentIds);
    const phaseIds = ((phases ?? []) as Array<{ id: string }>).map((p) => p.id);
    if (phaseIds.length === 0) return;
    const { count } = await this.supabase.service
      .from('matches')
      .select('id', { count: 'exact', head: true })
      .in('phase_id', phaseIds)
      .neq('status', 'scheduled');
    if ((count ?? 0) > 0) throw new ForbiddenException(message);
  }

  /**
   * Delete the RESTRICT-protected result graph (match_forfeits → matches →
   * registrations) for the given tournaments, so a following cascade delete of
   * the tournament/event isn't aborted by the registrations.person_id /
   * matches.*_registration_id foreign keys (which Postgres checks immediately).
   * Order matters: forfeits + matches reference registrations; registrations
   * reference persons.
   */
  private async clearTournamentResultGraph(tournamentIds: string[]): Promise<void> {
    if (tournamentIds.length === 0) return;
    const { data: phases } = await this.supabase.service
      .from('phases')
      .select('id')
      .in('tournament_id', tournamentIds);
    const phaseIds = ((phases ?? []) as Array<{ id: string }>).map((p) => p.id);

    const idsIn = async (table: string, column: string, values: string[]) => {
      if (values.length === 0) return [] as string[];
      const { data } = await this.supabase.service.from(table).select('id').in(column, values);
      return ((data ?? []) as Array<{ id: string }>).map((r) => r.id);
    };
    const purge = async (table: string, column: string, values: string[]) => {
      if (values.length === 0) return;
      const { error } = await this.supabase.service.from(table).delete().in(column, values);
      if (error) throw new BadRequestException(error.message);
    };

    // Referee assignments reference pools/matches with ON DELETE SET NULL; the
    // null-out would violate referee_assignments_scope_check, so clear them first.
    const poolIds = await idsIn('pools', 'phase_id', phaseIds);
    const matchIds = await idsIn('matches', 'phase_id', phaseIds);
    await purge('referee_assignments', 'pool_id', poolIds);
    await purge('referee_assignments', 'match_id', matchIds);

    await purge('match_forfeits', 'tournament_id', tournamentIds);
    await purge('matches', 'phase_id', phaseIds);
    await purge('registrations', 'tournament_id', tournamentIds);
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
        'id, organization_id, status, name, slug, start_date, end_date, city, country, logo_url, created_by_user_id, event_kind',
      )
      .eq('id', eventId)
      .maybeSingle();

    if (error) throw new BadRequestException(error.message);
    if (!data) throw new NotFoundException(`Event ${eventId} not found`);
    return data;
  }

  /**
   * Assert the caller is at least an org admin for a tournament's org. Shared
   * by the ruleset-drift read + acknowledge endpoints.
   */
  private async assertTournamentAdmin(tournamentId: string, userId: string): Promise<void> {
    const { data, error } = await this.supabase.service
      .from('tournaments')
      .select('event_id')
      .eq('id', tournamentId)
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!data) throw new NotFoundException(`Tournament ${tournamentId} not found`);
    const event = await this.getEventById((data as { event_id: string }).event_id);
    await this.orgs.assertOrgRole(
      (event as { organization_id: string }).organization_id,
      userId,
      'admin',
    );
  }

  /**
   * Read-only ruleset-drift check powering the organizer settings banner.
   * `drifted` is true when the tournament's effective (scoring, penalty)
   * behaviour changed since its content hash was last stamped — realistically a
   * super-admin editing the never-frozen built-in penalty ruleset. A hash-
   * compute failure is reported as not-drifted so an out-of-domain stored config
   * never 500s the settings page.
   */
  async getTournamentRulesetDrift(
    tournamentId: string,
    userId: string,
  ): Promise<{ drifted: boolean }> {
    await this.assertTournamentAdmin(tournamentId, userId);
    if (!this.rulesetHash) return { drifted: false };
    try {
      const { stored, current } = await this.rulesetHash.describeTournamentDrift(tournamentId);
      // A never-stamped tournament (stored == null — a legacy row, or one whose
      // best-effort stamp failed) has no baseline to drift FROM: report it as
      // not-drifted rather than flagging a change that never happened.
      return { drifted: stored != null && stored !== current };
    } catch {
      return { drifted: false };
    }
  }

  /**
   * Acknowledge ruleset drift: recompute + persist the tournament's content hash
   * so the stored fingerprint matches current effective behaviour, clearing the
   * banner. The organizer accepts the out-of-band change (e.g. an updated
   * built-in penalty) as applying to this tournament.
   */
  async acknowledgeTournamentRulesetDrift(
    tournamentId: string,
    userId: string,
  ): Promise<{ drifted: boolean }> {
    await this.assertTournamentAdmin(tournamentId, userId);
    await this.stampTournamentContentHash(tournamentId);
    return { drifted: false };
  }
}
