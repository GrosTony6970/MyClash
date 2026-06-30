import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { computeFinalRanking, type PoolEntry, type RankingSlot } from '@myclash/types';
import { sanitizePostgrestFilterValue } from '../../common/postgrest-filter';
import { SupabaseService } from '../supabase/supabase.service';
import { HemaRatingsService } from '../hema-ratings/hema-ratings.service';
import { CsvImportService } from '../persons/csv-import.service';
// Value imports (NOT `import type`) — these are DI-injected, so the runtime
// needs the class metadata preserved.
import { PhasesService } from '../phases/phases.service';
import { PoolStandingsService, type StandingsRow } from '../pool-standings/pool-standings.service';
import type {
  CreateFighterDto,
  CreateGlobalPersonDto,
  FighterQueryDto,
  FighterRolesDto,
  GlobalPersonQueryDto,
  ImportDecisionDto,
  PromoteFighterDto,
  RefereeProfileDto,
  UpdateGlobalPersonDto,
  UpdateMyFighterProfileDto,
  UpdateFighterDto,
} from './dto/fighters.dto';
import {
  buildFighterCareer,
  type CareerExchangeInput,
  type CareerLeagueRankingInput,
  type CareerMatchInput,
  type CareerRegistrationInput,
  type TournamentPlacement,
} from './fighter-career';
import {
  buildRefereeStats,
  type RefereeAssignmentInput,
  type RefereeMatchDurationInput,
  type RefereePenaltyInput,
  type RefereeSkillInfo,
} from './referee-stats';

export interface MatchSummary {
  id: string;
  matchScheduledAt: string | null;
  eventId: string;
  eventName: string;
  eventDate: string;
  tournamentId: string;
  tournamentName: string;
  weapon: string;
  opponentName: string;
  ourScore: number;
  opponentScore: number;
  outcome: 'win' | 'loss' | 'draw';
  status: string;
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
}

type Row = Record<string, unknown>;

const DEFAULT_WEAPONS = [
  'Longsword',
  'Rapier',
  'Sidesword',
  'Sabre',
  'Sword and Buckler',
  'Messer',
  'Dagger',
  'Ringen',
  'Spear',
  'Staff',
];

@Injectable()
export class FightersService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly csvImport: CsvImportService,
    private readonly hemaRatings?: HemaRatingsService,
    // Optional like hemaRatings: provided by FightersModule, but tests may
    // construct the service without them — placement computation degrades to
    // null rather than throwing.
    private readonly phases?: PhasesService,
    private readonly poolStandings?: PoolStandingsService,
  ) {}

  // ── List ────────────────────────────────────────────────────────────────────

  async list(query: FighterQueryDto) {
    let q = this.supabase.service
      .from('global_persons')
      .select('*, clubs(name, slug)')
      .order('family_name', { ascending: true })
      .order('given_name', { ascending: true });

    if (query.q) {
      // Strip PostgREST meta-characters before interpolating into `.or(...)`.
      // Without this, a `,` / `(` / `)` in `q` can inject sibling filter
      // clauses that broaden the WHERE beyond the intended search.
      const safe = sanitizePostgrestFilterValue(query.q);
      if (safe) {
        q = q.or(
          `given_name.ilike.%${safe}%,family_name.ilike.%${safe}%,display_name.ilike.%${safe}%`,
        ) as typeof q;
      }
    }
    if (query.club) {
      q = q.eq('clubs.slug', query.club) as typeof q;
    }

    const { data, error } = await q;
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  // ── Get by slug ──────────────────────────────────────────────────────────────

  async getBySlug(slug: string) {
    const { data, error } = await this.supabase.service
      .from('global_persons')
      .select('*, clubs(name, slug, city, country_code)')
      .eq('slug', slug)
      .maybeSingle();

    if (error) throw new BadRequestException(error.message);
    if (!data) throw new NotFoundException(`Fighter "${slug}" not found`);

    const row = data as Record<string, unknown>;
    const publicProfile = await this.withPublicProfileRelations(this.sanitizePublicFighter(row));
    const hemaRatingsId = row['hema_ratings_id'] as string | null | undefined;
    if (!hemaRatingsId || !this.hemaRatings) return publicProfile;

    try {
      return {
        ...publicProfile,
        hemaRatings: await this.hemaRatings.getProfile(hemaRatingsId),
      };
    } catch (error) {
      if (error instanceof NotFoundException) {
        return {
          ...publicProfile,
          hemaRatings: null,
          hemaRatingsPending: true,
        };
      }
      throw error;
    }
  }

  // ── Create ───────────────────────────────────────────────────────────────────

  async create(dto: CreateFighterDto) {
    const baseSlug = slugify(dto.displayName || `${dto.givenName}-${dto.familyName}`);
    const slug = `${baseSlug}-${Date.now().toString(36)}`;

    const { data, error } = await this.supabase.service
      .from('global_persons')
      .insert({
        slug,
        display_name: dto.displayName.trim(),
        given_name: dto.givenName.trim(),
        family_name: dto.familyName.trim(),
        club_id: dto.clubId ?? null,
        country_code: dto.countryCode?.toUpperCase() ?? null,
        hema_ratings_id: dto.hemaRatingsId ?? null,
        photo_url: dto.photoUrl ?? null,
        bio: dto.bio ?? null,
        date_of_birth: dto.dateOfBirth ?? null,
        gender_category: dto.genderCategory ?? null,
        is_fighter: true,
      })
      .select('*')
      .single();

    if (error) throw new BadRequestException(error.message);
    return data;
  }

  // ── Update ───────────────────────────────────────────────────────────────────

  async update(id: string, dto: UpdateFighterDto) {
    const updates: Record<string, unknown> = {};
    if (dto.givenName !== undefined) updates['given_name'] = dto.givenName.trim();
    if (dto.familyName !== undefined) updates['family_name'] = dto.familyName.trim();
    if (dto.displayName !== undefined) updates['display_name'] = dto.displayName.trim();
    if (dto.clubId !== undefined) updates['club_id'] = dto.clubId;
    if (dto.countryCode !== undefined) updates['country_code'] = dto.countryCode.toUpperCase();
    if (dto.hemaRatingsId !== undefined) updates['hema_ratings_id'] = dto.hemaRatingsId;
    if (dto.photoUrl !== undefined) updates['photo_url'] = dto.photoUrl;
    if (dto.bio !== undefined) updates['bio'] = dto.bio;
    if (dto.dateOfBirth !== undefined) updates['date_of_birth'] = dto.dateOfBirth;
    updates['updated_at'] = new Date().toISOString();

    const { data, error } = await this.supabase.service
      .from('global_persons')
      .update(updates)
      .eq('id', id)
      .select('*')
      .single();

    if (error) throw new BadRequestException(error.message);
    if (!data) throw new NotFoundException(`Fighter ${id} not found`);
    return data;
  }

  // ── Promote Person → Fighter ─────────────────────────────────────────────────

  async updateAsClaimedUser(id: string, dto: UpdateFighterDto, userId: string) {
    await this.assertFighterOwner(id, userId);
    return this.update(id, dto);
  }

  async listWeapons() {
    const { data, error } = await this.supabase.service
      .from('weapon_catalog')
      .select('*')
      .order('name', { ascending: true });

    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  async seedDefaultWeapons(): Promise<void> {
    const rows = DEFAULT_WEAPONS.map((name) => ({
      slug: slugify(name),
      name,
    }));
    await this.supabase.service.from('weapon_catalog').upsert(rows, { onConflict: 'slug' });
  }

  async getMyProfile(userId: string) {
    const { data, error } = await this.supabase.service
      .from('global_persons')
      .select('*, clubs(name, slug, city, country_code)')
      .eq('claimed_by_user_id', userId)
      .maybeSingle();

    if (error) throw new BadRequestException(error.message);
    if (!data) throw new NotFoundException('No claimed Fighter profile linked to this account');

    const row = data as Row;
    return {
      ...row,
      dateOfBirth: (row['date_of_birth'] as string | null) ?? null,
      clubs: await this.applyMainClubFallback(
        userId,
        row,
        await this.getFighterClubLinks(String(row['id'])),
      ),
      weapons: await this.getFighterWeaponLinks(String(row['id'])),
    };
  }

  /**
   * The fighter dashboard reads clubs from `fighter_clubs` only, but an
   * organiser sets a participant's club on the event-scoped `persons.club_id`
   * (and the global default lives on `global_persons.club_id`). When the user
   * has no `fighter_clubs` "main" row yet, synthesise one from
   * `global_persons.club_id` ?? the most-recent claimed `persons.club_id`, so
   * the organiser-entered "Main club" actually shows up.
   */
  private async applyMainClubFallback(userId: string, row: Row, clubs: Row[]): Promise<Row[]> {
    if (clubs.some((c) => (c['role'] as string) === 'main')) return clubs;

    // Best-effort: a failure here must never break loading the profile.
    try {
      let clubId = (row['club_id'] as string | null) ?? null;
      if (!clubId) {
        const { data } = await this.supabase.service
          .from('persons')
          .select('club_id, created_at')
          .eq('claimed_by_user_id', userId)
          .not('club_id', 'is', null)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        clubId = (data as { club_id: string | null } | null)?.club_id ?? null;
      }
      if (!clubId) return clubs;

      const { data: club } = await this.supabase.service
        .from('clubs')
        .select('id, slug, name, city, country_code')
        .eq('id', clubId)
        .maybeSingle();
      if (!club) return clubs;

      return [{ role: 'main', sort_order: 0, clubs: club }, ...clubs];
    } catch {
      return clubs;
    }
  }

  async updateMyProfile(userId: string, dto: UpdateMyFighterProfileDto) {
    await this.assertFighterOwner(dto.fighterId, userId);

    const mainClubId = dto.mainClub ? await this.resolveClubInput(dto.mainClub) : dto.clubId;
    const updateDto: UpdateFighterDto = {
      givenName: dto.givenName,
      familyName: dto.familyName,
      displayName: dto.displayName,
      clubId: mainClubId ?? undefined,
      countryCode: dto.countryCode,
      hemaRatingsId: dto.hemaRatingsId,
      photoUrl: dto.photoUrl,
      bio: dto.bio,
      dateOfBirth: dto.dateOfBirth,
    };
    await this.update(dto.fighterId, updateDto);

    if (dto.secondaryClubs !== undefined || dto.previousClubs !== undefined || dto.mainClub) {
      await this.replaceFighterClubs(
        dto.fighterId,
        dto.mainClub,
        dto.secondaryClubs,
        dto.previousClubs,
      );
    }
    if (dto.weapons !== undefined) await this.replaceFighterWeapons(dto.fighterId, dto.weapons);

    return this.getMyProfile(userId);
  }

  async getMyDashboard(userId: string) {
    const profile = await this.getMyProfile(userId);
    const personId = String((profile as Row)['id']);
    return {
      profile,
      career: await this.getCareerForFighter(personId),
      refereeStats: await this.getRefereeStatsForPerson(personId, true),
      // Per-weapon HEMA Ratings (rank + weighted rating) for the profile stats
      // tabs. Best-effort: a missing/unlinked id or an un-synced fighter must
      // never break dashboard load — mirror getBySlug's NotFound handling.
      hemaRatings: await this.getHemaRatingsForProfile(profile as Row),
    };
  }

  /** Resolve a fighter's HEMA Ratings profile (or null) from their linked
   *  `hema_ratings_id`, swallowing the not-found/un-synced case. */
  private async getHemaRatingsForProfile(profile: Row) {
    const hemaRatingsId = profile['hema_ratings_id'] as string | null | undefined;
    if (!hemaRatingsId || !this.hemaRatings) return null;
    try {
      return await this.hemaRatings.getProfile(hemaRatingsId);
    } catch (error) {
      if (error instanceof NotFoundException) return null;
      throw error;
    }
  }

  async getMyRefereeStats(userId: string) {
    const profile = await this.getMyProfile(userId);
    const personId = String((profile as Row)['id']);
    return this.getRefereeStatsForPerson(personId, true);
  }

  async listMatchesPaginated(
    slugOrId: string,
    opts: { limit: number; offset: number; eventId?: string; year?: number },
  ): Promise<{ items: MatchSummary[]; total: number }> {
    // Resolve to fighter id
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(slugOrId);
    let fighterId: string;
    if (isUuid) {
      fighterId = slugOrId;
    } else {
      const { data, error } = await this.supabase.service
        .from('global_persons')
        .select('id')
        .eq('slug', slugOrId)
        .maybeSingle();
      if (error) throw new BadRequestException(error.message);
      if (!data) throw new NotFoundException(`Fighter "${slugOrId}" not found`);
      fighterId = String((data as Row)['id']);
    }

    // Fetch all registrations for this fighter. registrations has no
    // global_person_id (legacy fighter_id dropped in 0083) — walk through
    // person_id → persons.global_person_id.
    const { data: regData, error: regError } = await this.supabase.service
      .from('registrations')
      .select(
        `id, tournament_id, persons!inner(global_person_id), tournaments(id, name, weapon, events(id, name, start_date, end_date))`,
      )
      .eq('persons.global_person_id', fighterId);
    if (regError) throw new BadRequestException(regError.message);

    const registrations = (regData ?? []) as Row[];
    if (registrations.length === 0) return { items: [], total: 0 };

    const regById = new Map<string, Row>();
    for (const reg of registrations) {
      regById.set(String(reg['id']), reg);
    }
    const registrationIds = registrations.map((r) => String(r['id']));

    // Build match query
    let matchQ = this.supabase.service
      .from('matches')
      .select(
        'id, status, scheduled_at, created_at, red_registration_id, blue_registration_id, winner_registration_id, red_score, blue_score, phases(tournament_id)',
        { count: 'exact' },
      )
      .or(
        `red_registration_id.in.(${registrationIds.join(',')}),blue_registration_id.in.(${registrationIds.join(',')})`,
      )
      .neq('status', 'scheduled');

    if (opts.eventId) {
      // filter by checking if the registration's tournament belongs to this event
      const eventRegIds = registrations
        .filter((r) => {
          const t = r['tournaments'] as Row | null;
          const e = t?.['events'] as Row | null;
          return e && String(e['id']) === opts.eventId;
        })
        .map((r) => String(r['id']));
      if (eventRegIds.length === 0) return { items: [], total: 0 };
      matchQ = matchQ.or(
        `red_registration_id.in.(${eventRegIds.join(',')}),blue_registration_id.in.(${eventRegIds.join(',')})`,
      ) as typeof matchQ;
    }

    if (opts.year) {
      const yearStr = String(opts.year);
      // Filter by scheduled_at year or event start_date year
      const yearRegIds = registrations
        .filter((r) => {
          const t = r['tournaments'] as Row | null;
          const e = t?.['events'] as Row | null;
          const startDate = (e?.['start_date'] as string | null) ?? null;
          return startDate?.startsWith(yearStr);
        })
        .map((r) => String(r['id']));
      if (yearRegIds.length === 0) return { items: [], total: 0 };
      matchQ = matchQ.or(
        `red_registration_id.in.(${yearRegIds.join(',')}),blue_registration_id.in.(${yearRegIds.join(',')})`,
      ) as typeof matchQ;
    }

    matchQ = matchQ
      .order('scheduled_at', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false })
      .range(opts.offset, opts.offset + opts.limit - 1);

    const { data: matchData, error: matchError, count } = await matchQ;
    if (matchError) throw new BadRequestException(matchError.message);

    // Fetch opponent names for all registrations involved
    const opponentRegIds = new Set<string>();
    for (const match of (matchData ?? []) as Row[]) {
      const redId = (match['red_registration_id'] as string | null) ?? null;
      const blueId = (match['blue_registration_id'] as string | null) ?? null;
      // The opponent is the registration NOT owned by this fighter
      if (redId && !regById.has(redId)) opponentRegIds.add(redId);
      if (blueId && !regById.has(blueId)) opponentRegIds.add(blueId);
    }

    const opponentNames = new Map<string, string>();
    if (opponentRegIds.size > 0) {
      const { data: oppData } = await this.supabase.service
        .from('registrations')
        // 0083 retired registrations.fighter_id (and there never was
        // a registrations.global_person_id — the original projection
        // was a copy-paste typo). Walk through persons.
        .select('id, persons(global_persons(display_name))')
        .in('id', [...opponentRegIds]);
      for (const row of (oppData ?? []) as Row[]) {
        const person = row['persons'] as Row | null;
        const gp = person?.['global_persons'] as Row | null;
        opponentNames.set(String(row['id']), String(gp?.['display_name'] ?? ''));
      }
    }

    const items: MatchSummary[] = ((matchData ?? []) as Row[]).map((match) => {
      const redId = (match['red_registration_id'] as string | null) ?? null;
      const blueId = (match['blue_registration_id'] as string | null) ?? null;
      const myRegId = regById.has(redId ?? '') ? redId : blueId;
      const oppRegId = regById.has(redId ?? '') ? blueId : redId;
      const myReg = myRegId ? regById.get(myRegId) : null;
      const tournament = (myReg?.['tournaments'] as Row | null) ?? null;
      const event = (tournament?.['events'] as Row | null) ?? null;
      const winnerRegId = (match['winner_registration_id'] as string | null) ?? null;
      const myScore =
        myRegId === redId ? Number(match['red_score'] ?? 0) : Number(match['blue_score'] ?? 0);
      const oppScore =
        myRegId === redId ? Number(match['blue_score'] ?? 0) : Number(match['red_score'] ?? 0);

      let outcome: 'win' | 'loss' | 'draw';
      if (!winnerRegId) {
        outcome = myScore === oppScore ? 'draw' : myScore > oppScore ? 'win' : 'loss';
      } else {
        outcome = winnerRegId === myRegId ? 'win' : 'loss';
      }

      const phase = match['phases'] as Row | null;
      return {
        id: String(match['id']),
        matchScheduledAt: (match['scheduled_at'] as string | null) ?? null,
        eventId: String(event?.['id'] ?? ''),
        eventName: String(event?.['name'] ?? ''),
        eventDate: String(event?.['start_date'] ?? event?.['end_date'] ?? ''),
        tournamentId: String(tournament?.['id'] ?? phase?.['tournament_id'] ?? ''),
        tournamentName: String(tournament?.['name'] ?? ''),
        weapon: String(tournament?.['weapon'] ?? ''),
        opponentName: oppRegId ? (opponentNames.get(oppRegId) ?? '') : '',
        ourScore: myScore,
        opponentScore: oppScore,
        outcome,
        status: String(match['status']),
      };
    });

    return { items, total: count ?? 0 };
  }

  async getCareerBySlug(slug: string, query: { year?: string; weapon?: string } = {}) {
    const { data, error } = await this.supabase.service
      .from('global_persons')
      .select('id, slug, display_name')
      .eq('slug', slug)
      .maybeSingle();

    if (error) throw new BadRequestException(error.message);
    if (!data) throw new NotFoundException(`Fighter "${slug}" not found`);
    return this.getCareerForFighter(String((data as Row)['id']), query);
  }

  async getRefereeStatsBySlug(slug: string) {
    const personId = await this.resolveRefereePersonIdForFighterSlug(slug);
    return personId
      ? this.getRefereeStatsForPerson(personId, false)
      : buildRefereeStats({
          userId: '',
          assignments: [],
          durations: [],
          penalties: [],
        });
  }

  async getCareerForFighter(fighterId: string, query: { year?: string; weapon?: string } = {}) {
    const registrations = await this.fetchCareerRegistrations(fighterId, query);
    const registrationIds = registrations.map((registration) => registration.id);
    const matches =
      registrationIds.length > 0 ? await this.fetchCareerMatches(registrationIds) : [];
    const exchanges =
      matches.length > 0 ? await this.fetchCareerExchanges(matches.map((match) => match.id)) : [];
    const leagueRankings = await this.fetchCareerLeagueRankings(fighterId);
    const placementByRegistrationId = await this.computeTournamentPlacements(registrations);

    return buildFighterCareer({
      fighterId,
      registrations,
      matches,
      exchanges,
      leagueRankings,
      placementByRegistrationId,
    });
  }

  /**
   * For each completed tournament the fighter competed in, compute their final
   * placement using the SAME shared `computeFinalRanking` the public tournament
   * page uses — so the number on the profile matches the number on the bracket.
   * Best-effort per tournament: any failure leaves that placement unset rather
   * than breaking dashboard load. Requires the phases + pool-standings services
   * (provided in production; absent in some unit tests).
   */
  private async computeTournamentPlacements(
    registrations: CareerRegistrationInput[],
  ): Promise<Map<string, TournamentPlacement>> {
    const placements = new Map<string, TournamentPlacement>();
    if (!this.phases || !this.poolStandings) return placements;

    const completed = registrations.filter(
      (registration) => registration.tournamentStatus === 'completed',
    );
    for (const registration of completed) {
      try {
        const placement = await this.computeOnePlacement(
          registration.tournamentId,
          registration.id,
        );
        if (placement) placements.set(registration.id, placement);
      } catch {
        // A single tournament's bracket/standings failing must never break the
        // whole career dashboard — skip and move on.
      }
    }
    return placements;
  }

  /** Placement of one registration in one tournament, mirroring the public
   *  FinalRankingTab (bracket slots + overall pool standings → computeFinalRanking).
   *  Falls back to the overall pool rank for pool-only tournaments. */
  private async computeOnePlacement(
    tournamentId: string,
    registrationId: string,
  ): Promise<TournamentPlacement | null> {
    let rows: StandingsRow[] = [];
    try {
      const standings = (await this.poolStandings!.getPoolStandings(tournamentId, 'overall')) as {
        rows?: StandingsRow[];
      };
      rows = standings.rows ?? [];
    } catch {
      rows = [];
    }
    const poolEntries: PoolEntry[] = rows.map((row) => {
      const rawScore = row.stats?.['score'];
      const score = typeof rawScore === 'number' ? rawScore : Number(rawScore);
      return {
        registrationId: row.registrationId,
        fighterName: row.displayName,
        clubAbbrev: row.club?.abbreviation ?? row.club?.name ?? null,
        poolScore: Number.isFinite(score) ? score : null,
      };
    });

    const bracket = await this.phases!.getTournamentBracket(tournamentId);
    if (bracket?.slots?.length) {
      const slots: RankingSlot[] = bracket.slots.map((slot) => ({
        id: slot.id,
        round: slot.round,
        position: slot.position,
        status: slot.status,
        redRegistrationId: slot.redRegistrationId ?? null,
        blueRegistrationId: slot.blueRegistrationId ?? null,
        redFighterName: slot.redFighterName ?? null,
        blueFighterName: slot.blueFighterName ?? null,
        redClubAbbrev: slot.redClubAbbrev ?? null,
        blueClubAbbrev: slot.blueClubAbbrev ?? null,
        redScore: slot.redScore ?? null,
        blueScore: slot.blueScore ?? null,
      }));
      // 2-arg call (no explicit bronzeSlotId) to match the public FinalRankingTab.
      const ranking = computeFinalRanking(slots, poolEntries);
      const entry = ranking.find((e) => e.registrationId === registrationId);
      if (entry) {
        return { place: entry.place, resultKind: entry.resultKind, totalRanked: ranking.length };
      }
    }

    // Pool-only tournament (or a bracket that isn't decided yet): use the
    // fighter's overall pool rank.
    const row = rows.find((r) => r.registrationId === registrationId);
    if (row && Number.isFinite(row.rank)) {
      return { place: row.rank, resultKind: 'pool', totalRanked: rows.length };
    }
    return null;
  }

  async promote(dto: PromoteFighterDto, claimedUserId: string) {
    // Verify the claimed user owns this Person
    const { data: person, error: personError } = await this.supabase.service
      .from('persons')
      .select('id, given_name, family_name, email, club_id, claimed_by_user_id, global_person_id')
      .eq('id', dto.personId)
      .maybeSingle();

    if (personError || !person) {
      throw new NotFoundException(`Person ${dto.personId} not found`);
    }

    const p = person as {
      id: string;
      given_name: string;
      family_name: string;
      email: string;
      club_id: string | null;
      claimed_by_user_id: string | null;
      global_person_id: string | null;
    };

    if (p.claimed_by_user_id !== claimedUserId) {
      throw new ForbiddenException('You can only promote your own Person profile to a Fighter');
    }

    if (p.global_person_id) {
      // Already promoted — return existing fighter
      const { data: existing } = await this.supabase.service
        .from('global_persons')
        .select('*')
        .eq('id', p.global_person_id)
        .maybeSingle();
      return existing;
    }

    // Create the global Fighter
    const displayName = `${p.given_name} ${p.family_name}`;
    const baseSlug = slugify(displayName);
    const slug = `${baseSlug}-${Date.now().toString(36)}`;

    const { data: fighter, error: fighterError } = await this.supabase.service
      .from('global_persons')
      .insert({
        slug,
        display_name: displayName,
        given_name: p.given_name,
        family_name: p.family_name,
        club_id: p.club_id,
        claimed_by_user_id: claimedUserId,
        is_fighter: true,
      })
      .select('*')
      .single();

    if (fighterError || !fighter) {
      throw new BadRequestException(`Failed to create Fighter: ${fighterError?.message}`);
    }

    const f = fighter as { id: string };

    // Link Person → Fighter
    await this.supabase.service
      .from('persons')
      .update({ global_person_id: f.id })
      .eq('id', dto.personId);

    return fighter;
  }

  private sanitizePublicFighter(row: Row): Row {
    const { date_of_birth: _dateOfBirth, ...publicRow } = row;
    return publicRow;
  }

  private async withPublicProfileRelations(row: Row): Promise<Row> {
    const id = String(row['id']);
    return {
      ...row,
      clubs: await this.getFighterClubLinks(id),
      weapons: await this.getFighterWeaponLinks(id),
    };
  }

  private async assertFighterOwner(fighterId: string, userId: string): Promise<void> {
    const { data, error } = await this.supabase.service
      .from('global_persons')
      .select('id, claimed_by_user_id')
      .eq('id', fighterId)
      .maybeSingle();

    if (error) throw new BadRequestException(error.message);
    if (!data) throw new NotFoundException(`Fighter ${fighterId} not found`);
    if ((data as Row)['claimed_by_user_id'] !== userId) {
      throw new ForbiddenException('You can only edit your own Fighter profile');
    }
  }

  private async getFighterClubLinks(fighterId: string) {
    const { data, error } = await this.supabase.service
      .from('fighter_clubs')
      .select('role, sort_order, clubs(id, slug, name, city, country_code)')
      .eq('global_person_id', fighterId)
      .order('sort_order', { ascending: true });

    if (error) return [];
    return data ?? [];
  }

  private async getFighterWeaponLinks(fighterId: string) {
    const { data, error } = await this.supabase.service
      .from('fighter_weapons')
      .select('favorite, sort_order, level, weapon_catalog(id, slug, name)')
      .eq('global_person_id', fighterId)
      .order('favorite', { ascending: false })
      .order('sort_order', { ascending: true });

    if (error) return [];
    return data ?? [];
  }

  private async resolveClubInput(input: {
    clubId?: string;
    clubName?: string;
  }): Promise<string | null> {
    if (input.clubId) return input.clubId;
    const name = input.clubName?.trim();
    if (!name) return null;

    const { data: existing } = await this.supabase.service
      .from('clubs')
      .select('id')
      .ilike('name', name)
      .maybeSingle();
    if (existing) return String((existing as Row)['id']);

    const slug = `${slugify(name)}-${Date.now().toString(36)}`;
    const { data, error } = await this.supabase.service
      .from('clubs')
      .insert({ name, slug, unverified: 'true' })
      .select('id')
      .single();
    if (error) throw new BadRequestException(error.message);
    return String((data as Row)['id']);
  }

  private async replaceFighterClubs(
    fighterId: string,
    mainClub?: { clubId?: string; clubName?: string },
    secondaryClubs: Array<{ clubId?: string; clubName?: string }> = [],
    previousClubs: Array<{ clubId?: string; clubName?: string }> = [],
  ): Promise<void> {
    await this.supabase.service.from('fighter_clubs').delete().eq('global_person_id', fighterId);
    const rows: Row[] = [];
    const add = async (
      role: 'main' | 'secondary' | 'previous',
      input: { clubId?: string; clubName?: string } | undefined,
      sortOrder: number,
    ) => {
      if (!input) return;
      const clubId = await this.resolveClubInput(input);
      if (!clubId) return;
      rows.push({ global_person_id: fighterId, club_id: clubId, role, sort_order: sortOrder });
    };

    await add('main', mainClub, 0);
    for (const [index, club] of secondaryClubs.entries()) await add('secondary', club, index);
    for (const [index, club] of previousClubs.entries()) await add('previous', club, index);
    if (rows.length === 0) return;

    const { error } = await this.supabase.service.from('fighter_clubs').insert(rows);
    if (error) throw new BadRequestException(error.message);
  }

  private async resolveWeaponInput(input: {
    weaponId?: string;
    weaponName?: string;
  }): Promise<string | null> {
    if (input.weaponId) return input.weaponId;
    const name = input.weaponName?.trim();
    if (!name) return null;

    const slug = slugify(name);
    const { data: existing } = await this.supabase.service
      .from('weapon_catalog')
      .select('id')
      .eq('slug', slug)
      .maybeSingle();
    if (existing) return String((existing as Row)['id']);

    const { data, error } = await this.supabase.service
      .from('weapon_catalog')
      .insert({ name, slug })
      .select('id')
      .single();
    if (error) throw new BadRequestException(error.message);
    return String((data as Row)['id']);
  }

  private async replaceFighterWeapons(
    fighterId: string,
    weapons: Array<{
      weaponId?: string;
      weaponName?: string;
      favorite?: boolean;
      level?: 'just_for_fun' | 'beginner' | 'intermediate' | 'advanced' | null;
    }>,
  ): Promise<void> {
    await this.supabase.service.from('fighter_weapons').delete().eq('global_person_id', fighterId);
    const rows: Row[] = [];
    for (const [index, weapon] of weapons.entries()) {
      const weaponId = await this.resolveWeaponInput(weapon);
      if (!weaponId) continue;
      rows.push({
        global_person_id: fighterId,
        weapon_id: weaponId,
        favorite: Boolean(weapon.favorite),
        level: weapon.level ?? null,
        sort_order: index,
      });
    }
    if (rows.length === 0) return;
    const { error } = await this.supabase.service.from('fighter_weapons').insert(rows);
    if (error) throw new BadRequestException(error.message);
  }

  private async fetchCareerRegistrations(
    fighterId: string,
    query: { year?: string; weapon?: string },
  ): Promise<CareerRegistrationInput[]> {
    let request = this.supabase.service
      .from('registrations')
      .select(
        `
        id, tournament_id, status,
        persons!inner ( global_person_id ),
        tournaments (
          id, name, slug, status, weapon,
          events ( id, name, slug, status, start_date, end_date )
        )
      `,
      )
      // registrations has no global_person_id (legacy fighter_id dropped in 0083);
      // identity flows through person_id → persons.global_person_id.
      .eq('persons.global_person_id', fighterId);
    if (query.weapon) request = request.eq('tournaments.weapon', query.weapon) as typeof request;

    const { data, error } = await request;
    if (error) throw new BadRequestException(error.message);

    return ((data ?? []) as Row[])
      .map((row) => {
        const tournament = row['tournaments'] as Row | null;
        const event = tournament?.['events'] as Row | null;
        return {
          id: String(row['id']),
          tournamentId: String(tournament?.['id'] ?? row['tournament_id']),
          tournamentName: String(tournament?.['name'] ?? ''),
          tournamentSlug: String(tournament?.['slug'] ?? ''),
          tournamentStatus: String(tournament?.['status'] ?? ''),
          weapon: (tournament?.['weapon'] as string | null) ?? null,
          eventId: String(event?.['id'] ?? ''),
          eventName: String(event?.['name'] ?? ''),
          eventSlug: String(event?.['slug'] ?? ''),
          eventStatus: String(event?.['status'] ?? ''),
          eventStartDate: (event?.['start_date'] as string | null) ?? null,
          eventEndDate: (event?.['end_date'] as string | null) ?? null,
        } satisfies CareerRegistrationInput;
      })
      .filter((registration) => !query.year || registration.eventStartDate?.startsWith(query.year));
  }

  private async fetchCareerMatches(registrationIds: string[]): Promise<CareerMatchInput[]> {
    const { data, error } = await this.supabase.service
      .from('matches')
      .select(
        'id, phase_id, status, red_registration_id, blue_registration_id, winner_registration_id, red_score, blue_score, scheduled_at, match_number_label, phases(tournament_id)',
      )
      .or(
        `red_registration_id.in.(${registrationIds.join(',')}),blue_registration_id.in.(${registrationIds.join(',')})`,
      );
    if (error) throw new BadRequestException(error.message);

    return ((data ?? []) as Row[]).map((row) => {
      const phase = row['phases'] as Row | null;
      const redId = (row['red_registration_id'] as string | null) ?? null;
      const blueId = (row['blue_registration_id'] as string | null) ?? null;
      return {
        id: String(row['id']),
        tournamentId: String(phase?.['tournament_id'] ?? ''),
        status: String(row['status']),
        redRegistrationId: redId,
        blueRegistrationId: blueId,
        winnerRegistrationId: (row['winner_registration_id'] as string | null) ?? null,
        redScore: Number(row['red_score'] ?? 0),
        blueScore: Number(row['blue_score'] ?? 0),
        scheduledAt: (row['scheduled_at'] as string | null) ?? null,
        matchNumberLabel: (row['match_number_label'] as string | null) ?? null,
        opponentName: null,
      };
    });
  }

  private async fetchCareerExchanges(matchIds: string[]): Promise<CareerExchangeInput[]> {
    const { data, error } = await this.supabase.service
      .from('exchanges')
      .select('id, match_id, type, voided')
      .in('match_id', matchIds);
    if (error) throw new BadRequestException(error.message);

    return ((data ?? []) as Row[]).map((row) => ({
      id: String(row['id']),
      matchId: String(row['match_id']),
      type: String(row['type']),
      voided: Boolean(row['voided']),
    }));
  }

  private async fetchCareerLeagueRankings(fighterId: string): Promise<CareerLeagueRankingInput[]> {
    const { data, error } = await this.supabase.service
      .from('league_rankings')
      // league_rankings keeps the column name `fighter_id`, now referencing
      // global_persons(id) (table renamed in 0023, column not renamed).
      .select('rank, total_points, ranking_group_key, leagues(name)')
      .eq('fighter_id', fighterId);
    if (error) return [];

    return ((data ?? []) as Row[]).map((row) => {
      const league = row['leagues'] as Row | null;
      return {
        leagueName: String(league?.['name'] ?? ''),
        rank: Number(row['rank'] ?? 0),
        totalPoints: Number(row['total_points'] ?? 0),
        group: String(row['ranking_group_key'] ?? ''),
      };
    });
  }

  private async resolveRefereePersonIdForFighterSlug(slug: string): Promise<string | null> {
    const { data, error } = await this.supabase.service
      .from('global_persons')
      .select('id')
      .eq('slug', slug)
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!data) throw new NotFoundException(`Fighter "${slug}" not found`);
    return String((data as Row)['id']);
  }

  private async getRefereeStatsForPerson(personId: string, includePrivateDetails: boolean) {
    const assignments = await this.fetchRefereeAssignmentsByPerson(personId);
    const matchIds = [...new Set(assignments.map((assignment) => assignment.matchId))];
    if (matchIds.length === 0) {
      return buildRefereeStats({ userId: personId, assignments: [], durations: [], penalties: [] });
    }

    const allAssignments = await this.fetchAssignmentsForMatches(matchIds);
    const durations = await this.fetchRefereeMatchDurations(matchIds);
    const penalties = await this.fetchRefereePenalties(matchIds);
    const buddyIds = [...new Set(allAssignments.map((assignment) => assignment.userId))].filter(
      (id) => id !== personId,
    );
    const buddiesByUserId = await this.fetchRefereeBuddyNames(buddyIds);
    const skillsByRole = includePrivateDetails
      ? await this.fetchRefereeSkillsByRole(allAssignments)
      : undefined;

    return buildRefereeStats({
      userId: personId,
      assignments: allAssignments,
      durations,
      penalties,
      buddiesByUserId,
      includePrivateDetails,
      skillsByRole,
    });
  }

  private async fetchRefereeSkillsByRole(
    assignments: RefereeAssignmentInput[],
  ): Promise<Map<string, RefereeSkillInfo>> {
    const roleValues = [...new Set(assignments.map((a) => a.role).filter(Boolean))] as string[];
    if (roleValues.length === 0) return new Map();

    const { data } = await this.supabase.service
      .from('referee_skills')
      .select('id, name, color')
      .in('id', roleValues);

    const map = new Map<string, RefereeSkillInfo>();
    for (const row of (data ?? []) as Row[]) {
      const id = String(row['id']);
      map.set(id, {
        skillId: id,
        skillName: String(row['name'] ?? ''),
        skillColor: String(row['color'] ?? ''),
      });
    }
    return map;
  }

  private async fetchRefereeAssignmentsByPerson(
    personId: string,
  ): Promise<RefereeAssignmentInput[]> {
    const { data, error } = await this.supabase.service
      .from('referee_assignments')
      .select(
        'match_id, person_id, role, matches(id, status, scheduled_at, pool_id, bracket_slot_id, pools(sort_order), bracket_slots(round), phases(type, config_json, tournaments(id, name, weapon, events(id, name))))',
      )
      .eq('person_id', personId)
      .eq('scope_type', 'match')
      .not('match_id', 'is', null);
    if (error) throw new BadRequestException(error.message);
    return this.mapRefereeAssignments(data ?? []);
  }

  private async fetchAssignmentsForMatches(matchIds: string[]): Promise<RefereeAssignmentInput[]> {
    const { data, error } = await this.supabase.service
      .from('referee_assignments')
      .select(
        'match_id, person_id, role, matches(id, status, scheduled_at, pool_id, bracket_slot_id, pools(sort_order), bracket_slots(round), phases(type, config_json, tournaments(id, name, weapon, events(id, name))))',
      )
      .in('match_id', matchIds)
      .eq('scope_type', 'match');
    if (error) throw new BadRequestException(error.message);
    return this.mapRefereeAssignments(data ?? []);
  }

  /**
   * Maps a referee_assignments row to a stats-engine input. The engine's
   * `userId` field is now populated with person_id (= global_persons.id)
   * for dedup/aggregation purposes — referee identity is no longer keyed
   * on Supabase auth.
   */
  private mapRefereeAssignments(rows: unknown[]): RefereeAssignmentInput[] {
    return (rows as Row[])
      .map((row) => {
        const match = row['matches'] as Row | null;
        if (match && String(match['status']) !== 'completed') return null;
        const phase = match?.['phases'] as Row | null;
        const tournament = phase?.['tournaments'] as Row | null;
        const event = tournament?.['events'] as Row | null;
        const pool = match?.['pools'] as Row | null;
        const bracketSlot = match?.['bracket_slots'] as Row | null;
        // bracketSize lives on the phase config (same source matches.service
        // uses to format round codes); pool sort_order is 0-indexed.
        const cfg = (phase?.['config_json'] as Record<string, unknown> | null) ?? null;
        const bracketSizeRaw = cfg ? (cfg['bracketSize'] ?? cfg['mainBracketSize']) : null;
        const poolSort = pool?.['sort_order'];
        const bracketRound = bracketSlot?.['round'];
        const assignment: RefereeAssignmentInput = {
          matchId: String(row['match_id']),
          userId: String(row['person_id']),
          role: (row['role'] as string | null) ?? null,
          eventId: (event?.['id'] as string | null) ?? null,
          eventName: (event?.['name'] as string | null) ?? null,
          tournamentId: (tournament?.['id'] as string | null) ?? null,
          tournamentName: (tournament?.['name'] as string | null) ?? null,
          weapon: (tournament?.['weapon'] as string | null) ?? null,
          scheduledAt: (match?.['scheduled_at'] as string | null) ?? null,
          phaseType: (phase?.['type'] as string | null) ?? null,
          poolNumber: typeof poolSort === 'number' ? poolSort + 1 : null,
          bracketRound: typeof bracketRound === 'number' ? bracketRound : null,
          bracketSize: typeof bracketSizeRaw === 'number' ? bracketSizeRaw : null,
        };
        return assignment;
      })
      .filter((assignment): assignment is RefereeAssignmentInput => Boolean(assignment));
  }

  private async fetchRefereeMatchDurations(
    matchIds: string[],
  ): Promise<RefereeMatchDurationInput[]> {
    const { data, error } = await this.supabase.service
      .from('matches')
      .select('id, duration_active_ms, match_events(type, occurred_at, adjustment_ms)')
      .in('id', matchIds);
    if (error) throw new BadRequestException(error.message);
    return ((data ?? []) as Row[]).map((row) => ({
      matchId: String(row['id']),
      durationActiveMs:
        row['duration_active_ms'] === null || row['duration_active_ms'] === undefined
          ? null
          : Number(row['duration_active_ms']),
      events: ((row['match_events'] as Row[] | null) ?? []).map((event) => ({
        type: String(event['type']),
        occurredAt: String(event['occurred_at']),
        adjustmentMs:
          event['adjustment_ms'] === null || event['adjustment_ms'] === undefined
            ? null
            : Number(event['adjustment_ms']),
      })),
    }));
  }

  private async fetchRefereePenalties(matchIds: string[]): Promise<RefereePenaltyInput[]> {
    const { data, error } = await this.supabase.service
      .from('match_penalties')
      .select('match_id, card, voided')
      .in('match_id', matchIds);
    if (error) return [];
    return ((data ?? []) as Row[]).map((row) => ({
      matchId: String(row['match_id']),
      card: String(row['card']),
      voided: Boolean(row['voided']),
    }));
  }

  private async fetchRefereeBuddyNames(
    personIds: string[],
  ): Promise<Record<string, { userId: string; displayName: string | null }>> {
    if (personIds.length === 0) return {};
    // Post-0063: referee identity is global_persons.id. Resolve display
    // names directly from the global table — works for both claimed and
    // unclaimed referees uniformly.
    const { data } = await this.supabase.service
      .from('global_persons')
      .select('id, given_name, family_name')
      .in('id', personIds);
    const result: Record<string, { userId: string; displayName: string | null }> = {};
    for (const personId of personIds) result[personId] = { userId: personId, displayName: null };
    for (const row of (data ?? []) as Row[]) {
      const id = String(row['id']);
      result[id] = {
        userId: id,
        displayName:
          `${String(row['given_name'] ?? '')} ${String(row['family_name'] ?? '')}`.trim(),
      };
    }
    return result;
  }

  // ── Global-persons new methods ────────────────────────────────────────────────

  async listGlobalPersons(query: GlobalPersonQueryDto) {
    let q = this.supabase.service
      .from('global_persons')
      .select('*, clubs(id, name, slug, abbreviation, city, country_code)')
      .order('family_name', { ascending: true })
      .order('given_name', { ascending: true });

    if (query.q) {
      // Strip PostgREST meta-characters before interpolating into `.or(...)`.
      // Without this, a `,` / `(` / `)` in `q` can inject sibling filter
      // clauses that broaden the WHERE beyond the intended search.
      const safe = sanitizePostgrestFilterValue(query.q);
      if (safe) {
        q = q.or(
          `given_name.ilike.%${safe}%,family_name.ilike.%${safe}%,display_name.ilike.%${safe}%`,
        ) as typeof q;
      }
    }
    if (query.roles) {
      for (const role of query.roles) {
        q = q.eq(`is_${role}`, true) as typeof q;
      }
    }

    const { data, error } = await q;
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  async createGlobalPerson(dto: CreateGlobalPersonDto) {
    const displayName = this.resolveDisplayName(dto.givenName, dto.familyName, dto.displayName);
    this.assertAtLeastOneRole({
      isFighter: dto.isFighter,
      isReferee: dto.isReferee,
      isWorkshopParticipant: dto.isWorkshopParticipant,
    });
    const clubId = await this.resolveGlobalPersonClubInput(dto);
    const baseSlug = slugify(displayName);
    const slug = `${baseSlug}-${Date.now().toString(36)}`;

    const { data, error } = await this.supabase.service
      .from('global_persons')
      .insert({
        slug,
        display_name: displayName,
        given_name: dto.givenName.trim(),
        family_name: dto.familyName.trim(),
        club_id: clubId,
        hema_ratings_id: this.trimOptional(dto.hemaRatingsId),
        email: dto.email?.trim().toLowerCase() || null,
        date_of_birth: dto.dateOfBirth?.trim() || null,
        is_fighter: dto.isFighter ?? false,
        is_referee: dto.isReferee ?? false,
        is_workshop_participant: dto.isWorkshopParticipant ?? false,
      })
      .select('*, clubs(id, name, slug, abbreviation, city, country_code)')
      .single();

    if (error) {
      // Partial unique index on LOWER(email) from migration 0075 —
      // surface as a 409 so the UI can render a friendly message.
      if (/duplicate key|unique/i.test(error.message)) {
        throw new ConflictException('email_in_use');
      }
      throw new BadRequestException(error.message);
    }

    if (dto.isReferee) {
      await this.ensureRefereeProfile(String((data as Row)['id']));
    }

    return data;
  }

  async updateGlobalPerson(id: string, dto: UpdateGlobalPersonDto) {
    const { data: existing, error: existingError } = await this.supabase.service
      .from('global_persons')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (existingError) throw new BadRequestException(existingError.message);
    if (!existing) throw new NotFoundException(`Global person ${id} not found`);

    const row = existing as Row;
    const nextRoles = {
      isFighter: dto.isFighter ?? Boolean(row['is_fighter']),
      isReferee: dto.isReferee ?? Boolean(row['is_referee']),
      isWorkshopParticipant: dto.isWorkshopParticipant ?? Boolean(row['is_workshop_participant']),
    };
    this.assertAtLeastOneRole(nextRoles);

    const updates: Record<string, unknown> = {};
    if (dto.givenName !== undefined) updates['given_name'] = dto.givenName.trim();
    if (dto.familyName !== undefined) updates['family_name'] = dto.familyName.trim();
    if (dto.displayName !== undefined) {
      const givenName = String(updates['given_name'] ?? row['given_name'] ?? '');
      const familyName = String(updates['family_name'] ?? row['family_name'] ?? '');
      updates['display_name'] = this.resolveDisplayName(givenName, familyName, dto.displayName);
    }
    if (this.hasClubInput(dto)) {
      updates['club_id'] = await this.resolveGlobalPersonClubInput(dto);
    }
    if (dto.hemaRatingsId !== undefined) {
      updates['hema_ratings_id'] = this.trimOptional(dto.hemaRatingsId);
    }
    if (dto.email !== undefined) {
      updates['email'] = dto.email?.trim().toLowerCase() || null;
    }
    if (dto.dateOfBirth !== undefined) {
      updates['date_of_birth'] = dto.dateOfBirth?.trim() || null;
    }
    if (dto.isFighter !== undefined) updates['is_fighter'] = dto.isFighter;
    if (dto.isReferee !== undefined) updates['is_referee'] = dto.isReferee;
    if (dto.isWorkshopParticipant !== undefined) {
      updates['is_workshop_participant'] = dto.isWorkshopParticipant;
    }
    updates['updated_at'] = new Date().toISOString();

    const { data, error } = await this.supabase.service
      .from('global_persons')
      .update(updates)
      .eq('id', id)
      .select('*, clubs(id, name, slug, abbreviation, city, country_code)')
      .single();

    if (error) {
      if (/duplicate key|unique/i.test(error.message)) {
        throw new ConflictException('email_in_use');
      }
      throw new BadRequestException(error.message);
    }
    if (!data) throw new NotFoundException(`Global person ${id} not found`);

    if (nextRoles.isReferee) await this.ensureRefereeProfile(id);
    return data;
  }

  async previewGlobalPersonsImport(buffer: Buffer): Promise<{
    summary: { total: number; ok: number; invalid: number; duplicate: number };
    rows: Array<{
      index: number;
      status: 'ok' | 'invalid' | 'duplicate';
      reasons: string[];
      duplicate: { id: string; displayName: string } | null;
      raw: string;
      fields: {
        givenName: string;
        familyName: string;
        displayName: string;
        hemaRatingsId: string | null;
        email: string | null;
        dateOfBirth: string | null;
        clubLabel: string | null;
        clubAbbreviation: string | null;
        clubCity: string | null;
        isFighter: boolean;
        isReferee: boolean;
        isWorkshopParticipant: boolean;
      };
    }>;
  }> {
    const parsed = this.csvImport.parse(buffer);
    const validRows = parsed.rows;
    const invalidRows = parsed.invalid;

    // Collect lookup keys for duplicate detection
    const nameKeys = new Set<string>();
    const hemaIds = new Set<string>();
    for (const row of validRows) {
      nameKeys.add(
        `${row.given_name.toLowerCase().trim()} ${row.family_name.toLowerCase().trim()}`,
      );
      if (row.hema_ratings_id) hemaIds.add(row.hema_ratings_id);
    }

    const nameMatches = new Map<string, { id: string; displayName: string }>();
    const hemaMatches = new Map<string, { id: string; displayName: string }>();

    if (nameKeys.size > 0 || hemaIds.size > 0) {
      const { data: existing } = await this.supabase.service
        .from('global_persons')
        .select('id, given_name, family_name, display_name, hema_ratings_id')
        .is('deleted_at', null);
      for (const row of (existing ?? []) as Row[]) {
        const id = String(row['id']);
        const given = String(row['given_name'] ?? '')
          .toLowerCase()
          .trim();
        const family = String(row['family_name'] ?? '')
          .toLowerCase()
          .trim();
        const displayName = String(row['display_name'] ?? '');
        const key = `${given} ${family}`;
        if (!nameMatches.has(key)) nameMatches.set(key, { id, displayName });
        const hema = typeof row['hema_ratings_id'] === 'string' ? row['hema_ratings_id'] : null;
        if (hema && !hemaMatches.has(hema)) hemaMatches.set(hema, { id, displayName });
      }
    }

    const out: Awaited<ReturnType<FightersService['previewGlobalPersonsImport']>>['rows'] = [];

    for (const inv of invalidRows) {
      out.push({
        index: inv.row,
        status: 'invalid',
        reasons: [inv.reason],
        duplicate: null,
        raw: inv.raw ?? '',
        fields: {
          givenName: '',
          familyName: '',
          displayName: '',
          hemaRatingsId: null,
          email: null,
          dateOfBirth: null,
          clubLabel: null,
          clubAbbreviation: null,
          clubCity: null,
          isFighter: false,
          isReferee: false,
          isWorkshopParticipant: false,
        },
      });
    }

    for (const row of validRows) {
      const key = `${row.given_name.toLowerCase().trim()} ${row.family_name.toLowerCase().trim()}`;
      const dupByName = nameMatches.get(key);
      const dupByHema = row.hema_ratings_id ? hemaMatches.get(row.hema_ratings_id) : undefined;
      const duplicate = dupByName ?? dupByHema ?? null;
      out.push({
        index: row.rowNumber,
        status: duplicate ? 'duplicate' : 'ok',
        reasons: [],
        duplicate,
        raw: '',
        fields: {
          givenName: row.given_name,
          familyName: row.family_name,
          displayName: row.display_name?.trim() || `${row.given_name} ${row.family_name}`,
          hemaRatingsId: row.hema_ratings_id ?? null,
          email: row.email ?? null,
          dateOfBirth: row.date_of_birth ?? null,
          clubLabel: row.club ?? null,
          clubAbbreviation: row.club_abv ?? null,
          clubCity: row.club_city ?? null,
          isFighter: parseBoolCell(row.is_fighter),
          isReferee: parseBoolCell(row.is_referee),
          isWorkshopParticipant: parseBoolCell(row.is_workshop_participant),
        },
      });
    }

    out.sort((a, b) => a.index - b.index);

    const summary = out.reduce(
      (acc, row) => {
        acc.total++;
        acc[row.status]++;
        return acc;
      },
      { total: 0, ok: 0, invalid: 0, duplicate: 0 },
    );

    return { summary, rows: out };
  }

  async commitGlobalPersonsImport(decisions: ImportDecisionDto[]): Promise<{
    created: number;
    updated: number;
    skipped: number;
    failed: Array<{ index: number; reason: string }>;
    newClubs: string[];
  }> {
    let created = 0;
    let updated = 0;
    let skipped = 0;
    const failed: Array<{ index: number; reason: string }> = [];
    const newClubs: string[] = [];

    for (const decision of decisions) {
      if (decision.action === 'skip') {
        skipped++;
        continue;
      }

      const givenName = decision.givenName?.trim();
      const familyName = decision.familyName?.trim();
      if (!givenName || !familyName) {
        failed.push({ index: decision.index, reason: 'Missing given_name or family_name' });
        continue;
      }

      let clubId: string | null = null;
      if (decision.clubLabel || decision.clubAbbreviation) {
        clubId = await this.resolveOrCreateClubForImport(
          {
            name: decision.clubLabel,
            abv: decision.clubAbbreviation,
            city: decision.clubCity,
          },
          newClubs,
        );
      }

      const displayName = decision.displayName?.trim() || `${givenName} ${familyName}`;
      const emailRaw = decision.email?.trim().toLowerCase() || null;
      const dobRaw = decision.dateOfBirth?.trim() || null;
      if (dobRaw && !/^\d{4}-\d{2}-\d{2}$/.test(dobRaw)) {
        failed.push({
          index: decision.index,
          reason: `Invalid date_of_birth: ${dobRaw} (expected YYYY-MM-DD)`,
        });
        continue;
      }
      // The super-admin has reviewed every row in the table; trust the
      // explicit per-row decision here. The no-overwrite-if-set rule
      // only applies to the auto-resolve path used by per-event
      // participant adds (persons.service.resolveOrCreateGlobalPerson).
      const payload = {
        display_name: displayName,
        given_name: givenName,
        family_name: familyName,
        club_id: clubId,
        hema_ratings_id: decision.hemaRatingsId?.trim() || null,
        email: emailRaw,
        date_of_birth: dobRaw,
        is_fighter: decision.isFighter ? 'true' : 'false',
        is_referee: decision.isReferee ? 'true' : 'false',
        is_workshop_participant: decision.isWorkshopParticipant ? 'true' : 'false',
      };

      try {
        if (decision.action === 'overwrite') {
          if (!decision.targetGlobalPersonId) {
            failed.push({
              index: decision.index,
              reason: 'targetGlobalPersonId required for overwrite',
            });
            continue;
          }
          const { error } = await this.supabase.service
            .from('global_persons')
            .update({ ...payload, updated_at: new Date().toISOString() })
            .eq('id', decision.targetGlobalPersonId);
          if (error) {
            failed.push({ index: decision.index, reason: error.message });
            continue;
          }
          updated++;
        } else {
          const baseSlug = slugify(displayName);
          const slug = `${baseSlug}-${Date.now().toString(36)}`;
          const { error } = await this.supabase.service
            .from('global_persons')
            .insert({ slug, ...payload });
          if (error) {
            failed.push({ index: decision.index, reason: error.message });
            continue;
          }
          created++;
        }
      } catch (err) {
        failed.push({
          index: decision.index,
          reason: err instanceof Error ? err.message : 'Unknown error',
        });
      }
    }

    return { created, updated, skipped, failed, newClubs: [...new Set(newClubs)] };
  }

  private async resolveOrCreateClubForImport(
    club: { name?: string; abv?: string; city?: string },
    newClubs: string[],
  ): Promise<string | null> {
    // Try exact abbreviation match first
    if (club.abv) {
      const { data: byAbv } = await this.supabase.service
        .from('clubs')
        .select('id')
        .ilike('abbreviation', club.abv.trim())
        .maybeSingle();
      if (byAbv) return String((byAbv as Row)['id']);
    }

    // Try exact name match
    if (club.name) {
      const { data: byName } = await this.supabase.service
        .from('clubs')
        .select('id')
        .ilike('name', club.name.trim())
        .maybeSingle();
      if (byName) return String((byName as Row)['id']);
    }

    // Create unverified club
    const name = club.name || club.abv || '';
    if (!name) return null;

    const slug = `${slugify(name)}-${Date.now().toString(36)}`;
    const { data, error } = await this.supabase.service
      .from('clubs')
      .insert({
        name,
        slug,
        abbreviation: club.abv?.trim().toUpperCase() ?? null,
        city: club.city ?? null,
        unverified: 'true',
      })
      .select('id')
      .single();

    if (error) return null;
    newClubs.push(name);
    return String((data as Row)['id']);
  }

  private resolveDisplayName(
    givenName: string,
    familyName: string,
    displayName?: string | null,
  ): string {
    const explicit = displayName?.trim();
    if (explicit) return explicit;
    return `${givenName.trim()} ${familyName.trim()}`.trim();
  }

  private assertAtLeastOneRole(roles: {
    isFighter?: boolean;
    isReferee?: boolean;
    isWorkshopParticipant?: boolean;
  }): void {
    if (!roles.isFighter && !roles.isReferee && !roles.isWorkshopParticipant) {
      throw new BadRequestException('At least one global profile role is required');
    }
  }

  private trimOptional(value: string | null | undefined): string | null {
    const trimmed = value?.trim();
    return trimmed ? trimmed : null;
  }

  private hasClubInput(input: {
    clubId?: string | null;
    clubName?: string;
    clubAbbreviation?: string;
    clubCity?: string;
  }): boolean {
    return (
      input.clubId !== undefined ||
      input.clubName !== undefined ||
      input.clubAbbreviation !== undefined ||
      input.clubCity !== undefined
    );
  }

  private async resolveGlobalPersonClubInput(input: {
    clubId?: string | null;
    clubName?: string;
    clubAbbreviation?: string;
    clubCity?: string;
  }): Promise<string | null> {
    if (input.clubId !== undefined) return input.clubId || null;
    if (!input.clubName && !input.clubAbbreviation) return null;
    return this.resolveOrCreateClubForImport(
      {
        name: this.trimOptional(input.clubName) ?? undefined,
        abv: this.trimOptional(input.clubAbbreviation) ?? undefined,
        city: this.trimOptional(input.clubCity) ?? undefined,
      },
      [],
    );
  }

  private async ensureRefereeProfile(globalPersonId: string): Promise<void> {
    await this.supabase.service
      .from('referee_profiles')
      .upsert(
        { global_person_id: globalPersonId },
        { onConflict: 'global_person_id', ignoreDuplicates: true },
      );
  }

  async setRoles(id: string, dto: FighterRolesDto) {
    const updates: Record<string, unknown> = {};
    if (dto.isFighter !== undefined) updates['is_fighter'] = dto.isFighter;
    if (dto.isReferee !== undefined) updates['is_referee'] = dto.isReferee;
    if (dto.isWorkshopParticipant !== undefined)
      updates['is_workshop_participant'] = dto.isWorkshopParticipant;
    updates['updated_at'] = new Date().toISOString();

    const { data, error } = await this.supabase.service
      .from('global_persons')
      .update(updates)
      .eq('id', id)
      .select('*')
      .single();

    if (error) throw new BadRequestException(error.message);
    if (!data) throw new NotFoundException(`Global person ${id} not found`);

    if (dto.isReferee === true) {
      await this.supabase.service
        .from('referee_profiles')
        .upsert(
          { global_person_id: id },
          { onConflict: 'global_person_id', ignoreDuplicates: true },
        );
    }

    return data;
  }

  async getRefereeProfile(id: string) {
    const { data, error } = await this.supabase.service
      .from('referee_profiles')
      .select('*')
      .eq('global_person_id', id)
      .maybeSingle();

    if (error) throw new BadRequestException(error.message);
    if (!data) throw new NotFoundException(`No referee profile for global person ${id}`);
    return data;
  }

  async upsertRefereeProfile(id: string, dto: RefereeProfileDto) {
    const { data, error } = await this.supabase.service
      .from('referee_profiles')
      .upsert({
        global_person_id: id,
        certifications: dto.certifications ?? [],
        notes: dto.notes ?? null,
        updated_at: new Date().toISOString(),
      })
      .select('*')
      .single();

    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async linkRefereeQualification(qualificationId: string, globalPersonId: string) {
    const { error } = await this.supabase.service
      .from('referee_qualifications')
      .update({ global_person_id: globalPersonId })
      .eq('id', qualificationId)
      .is('global_person_id', null);

    if (error) throw new BadRequestException(error.message);
  }

  async linkWorkshopEnrollment(enrollmentId: string, globalPersonId: string) {
    const { error } = await this.supabase.service
      .from('workshop_enrollments')
      .update({ global_person_id: globalPersonId })
      .eq('id', enrollmentId)
      .is('global_person_id', null);

    if (error) throw new BadRequestException(error.message);
  }
}

/**
 * Parse a CSV cell as a boolean. Accepts (case-insensitive):
 *   "1" / "0", "true" / "false", "yes" / "no". Empty / undefined → false.
 * Anything else also → false — we never want a half-imported row to inherit
 * accidental truthiness.
 */
export function parseBoolCell(value: string | undefined | null): boolean {
  if (value === undefined || value === null) return false;
  const trimmed = value.trim().toLowerCase();
  return trimmed === '1' || trimmed === 'true' || trimmed === 'yes';
}
