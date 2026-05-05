import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { HemaRatingsService } from '../hema-ratings/hema-ratings.service';
import type {
  CreateFighterDto,
  FighterQueryDto,
  PromoteFighterDto,
  UpdateMyFighterProfileDto,
  UpdateFighterDto,
} from './dto/fighters.dto';
import {
  buildFighterCareer,
  type CareerExchangeInput,
  type CareerLeagueRankingInput,
  type CareerMatchInput,
  type CareerRegistrationInput,
} from './fighter-career';

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
    private readonly hemaRatings?: HemaRatingsService,
  ) {}

  // ── List ────────────────────────────────────────────────────────────────────

  async list(query: FighterQueryDto) {
    let q = this.supabase.service
      .from('fighters')
      .select('*, clubs(name, slug)')
      .order('family_name', { ascending: true })
      .order('given_name', { ascending: true });

    if (query.q) {
      q = q.or(
        `given_name.ilike.%${query.q}%,family_name.ilike.%${query.q}%,display_name.ilike.%${query.q}%`,
      ) as typeof q;
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
      .from('fighters')
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
      .from('fighters')
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
      .from('fighters')
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
      .from('fighters')
      .select('*, clubs(name, slug, city, country_code)')
      .eq('claimed_by_user_id', userId)
      .maybeSingle();

    if (error) throw new BadRequestException(error.message);
    if (!data) throw new NotFoundException('No claimed Fighter profile linked to this account');

    const row = data as Row;
    return {
      ...row,
      dateOfBirth: (row['date_of_birth'] as string | null) ?? null,
      clubs: await this.getFighterClubLinks(String(row['id'])),
      weapons: await this.getFighterWeaponLinks(String(row['id'])),
    };
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
    return {
      profile,
      career: await this.getCareerForFighter(String((profile as Row)['id'])),
    };
  }

  async getCareerBySlug(slug: string, query: { year?: string; weapon?: string } = {}) {
    const { data, error } = await this.supabase.service
      .from('fighters')
      .select('id, slug, display_name')
      .eq('slug', slug)
      .maybeSingle();

    if (error) throw new BadRequestException(error.message);
    if (!data) throw new NotFoundException(`Fighter "${slug}" not found`);
    return this.getCareerForFighter(String((data as Row)['id']), query);
  }

  async getCareerForFighter(fighterId: string, query: { year?: string; weapon?: string } = {}) {
    const registrations = await this.fetchCareerRegistrations(fighterId, query);
    const registrationIds = registrations.map((registration) => registration.id);
    const matches =
      registrationIds.length > 0 ? await this.fetchCareerMatches(registrationIds) : [];
    const exchanges =
      matches.length > 0 ? await this.fetchCareerExchanges(matches.map((match) => match.id)) : [];
    const leagueRankings = await this.fetchCareerLeagueRankings(fighterId);

    return buildFighterCareer({
      fighterId,
      registrations,
      matches,
      exchanges,
      leagueRankings,
    });
  }

  async promote(dto: PromoteFighterDto, claimedUserId: string) {
    // Verify the claimed user owns this Person
    const { data: person, error: personError } = await this.supabase.service
      .from('persons')
      .select('id, given_name, family_name, email, club_id, claimed_by_user_id, global_fighter_id')
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
      global_fighter_id: string | null;
    };

    if (p.claimed_by_user_id !== claimedUserId) {
      throw new ForbiddenException('You can only promote your own Person profile to a Fighter');
    }

    if (p.global_fighter_id) {
      // Already promoted — return existing fighter
      const { data: existing } = await this.supabase.service
        .from('fighters')
        .select('*')
        .eq('id', p.global_fighter_id)
        .maybeSingle();
      return existing;
    }

    // Create the global Fighter
    const displayName = `${p.given_name} ${p.family_name}`;
    const baseSlug = slugify(displayName);
    const slug = `${baseSlug}-${Date.now().toString(36)}`;

    const { data: fighter, error: fighterError } = await this.supabase.service
      .from('fighters')
      .insert({
        slug,
        display_name: displayName,
        given_name: p.given_name,
        family_name: p.family_name,
        club_id: p.club_id,
        claimed_by_user_id: claimedUserId,
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
      .update({ global_fighter_id: f.id })
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
      .from('fighters')
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
      .eq('fighter_id', fighterId)
      .order('sort_order', { ascending: true });

    if (error) return [];
    return data ?? [];
  }

  private async getFighterWeaponLinks(fighterId: string) {
    const { data, error } = await this.supabase.service
      .from('fighter_weapons')
      .select('favorite, sort_order, weapon_catalog(id, slug, name)')
      .eq('fighter_id', fighterId)
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
    await this.supabase.service.from('fighter_clubs').delete().eq('fighter_id', fighterId);
    const rows: Row[] = [];
    const add = async (
      role: 'main' | 'secondary' | 'previous',
      input: { clubId?: string; clubName?: string } | undefined,
      sortOrder: number,
    ) => {
      if (!input) return;
      const clubId = await this.resolveClubInput(input);
      if (!clubId) return;
      rows.push({ fighter_id: fighterId, club_id: clubId, role, sort_order: sortOrder });
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
    weapons: Array<{ weaponId?: string; weaponName?: string; favorite?: boolean }>,
  ): Promise<void> {
    await this.supabase.service.from('fighter_weapons').delete().eq('fighter_id', fighterId);
    const rows: Row[] = [];
    for (const [index, weapon] of weapons.entries()) {
      const weaponId = await this.resolveWeaponInput(weapon);
      if (!weaponId) continue;
      rows.push({
        fighter_id: fighterId,
        weapon_id: weaponId,
        favorite: Boolean(weapon.favorite),
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
        tournaments (
          id, name, slug, status, weapon, category,
          events ( id, name, slug, status, start_date, end_date )
        )
      `,
      )
      .eq('fighter_id', fighterId);
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
          category: (tournament?.['category'] as string | null) ?? null,
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
}
