import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { asEventKind, countsTowardStats } from '@myclash/types';
import { sanitizePostgrestFilterValue } from '../../common/postgrest-filter';
import { SupabaseService } from '../supabase/supabase.service';
import { HemaRatingsService } from '../hema-ratings/hema-ratings.service';
import { CsvImportService } from '../persons/csv-import.service';
import { replaceFighterWeaponsFromCell } from './weapon-import.util';
import { applyReachable } from './directory-predicate';
// Value import (NOT `import type`) — DI-injected, so the runtime needs the
// class metadata preserved.
import { TournamentPlacementService } from '../tournament-placement/tournament-placement.service';
// Value import for the same DI reason as TournamentPlacementService above.
import { ErasureService } from '../privacy/erasure.service';
import type {
  CreateFighterDto,
  CreateGlobalPersonDto,
  FighterQueryDto,
  GlobalPersonQueryDto,
  ImportDecisionDto,
  PromoteFighterDto,
  UpdateGlobalPersonDto,
  UpdateMyFighterProfileDto,
  UpdateFighterDto,
} from './dto/fighters.dto';
import {
  buildFighterCareer,
  type CareerExchangeInput,
  type CareerLeagueRankingInput,
  type CareerMatchInput,
  type CareerPenaltyInput,
  type CareerRegistrationInput,
  type TournamentPlacement,
} from './fighter-career';
import {
  buildRefereeStats,
  type MatchFighters,
  type RefereeAssignmentInput,
  type RefereeMatchDurationInput,
  type RefereePenaltyInput,
  type RefereeSkillInfo,
} from './referee-stats';
import { sideColorsFromScoringConfig } from '../events/side-colors';
import {
  buildProfileRecentMatch,
  type ProfileRecentMatch,
  type RecentMatchRow,
} from './recent-matches';

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

// Fighter profile photos live in their own bucket (not the events
// `event-assets` bucket) so their 15 MB cap isn't blocked by that
// bucket's 10 MB `fileSizeLimit`. The client cropper re-encodes to a
// small square JPEG, so real uploads are tiny; the cap guards the raw
// source file that slips through client-side validation.
const FIGHTER_PHOTO_BUCKET = 'fighter-photos';
const FIGHTER_PHOTO_MAX_BYTES = 15 * 1024 * 1024;
const ALLOWED_FIGHTER_PHOTO_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

export interface FighterPhotoUpload {
  buffer: Buffer;
  filename: string;
  mimetype: string;
}

type Row = Record<string, unknown>;

/** Completed matches shown inline on the profile "recent results" strip; the
 *  full history is behind the "show all matches" modal. */
const RECENT_COMPLETED_LIMIT = 5;

/**
 * Page size for GET /fighters. Matches the organiser directory's numbers.
 *
 * The list was previously unbounded: with no query it returned every
 * global_persons row plus a club embed for each, in one response.
 */
const DEFAULT_FIGHTER_PAGE = 24;
const MAX_FIGHTER_PAGE = 50;

/**
 * Fighter-profile fields a user can hide from their public profile, mapped to
 * the underlying column(s). `defaultPublic: false` means hidden unless the user
 * opts in (date_of_birth stays private by default, preserving prior behaviour).
 */
const VISIBILITY_FIELDS: Record<string, { columns: string[]; defaultPublic: boolean }> = {
  dateOfBirth: { columns: ['date_of_birth'], defaultPublic: false },
  nationality: { columns: ['country_code'], defaultPublic: true },
  gender: { columns: ['gender_category'], defaultPublic: true },
  bio: { columns: ['bio'], defaultPublic: true },
  alias: { columns: ['alias'], defaultPublic: true },
  links: { columns: ['website_url', 'instagram_url', 'youtube_url'], defaultPublic: true },
  practicingSince: { columns: ['practicing_since_year'], defaultPublic: true },
};

/**
 * Every column a PUBLIC fighter read may return. An ALLOW-list.
 *
 * This replaces a deny-list — `select('*')` minus three `delete` calls — that
 * failed OPEN: any column added to `global_persons` shipped to anonymous
 * callers on the day it landed, and nobody had to decide that. The table has
 * grown eleven columns since that projection was written, `email` (0075) among
 * them; it stayed private only because someone remembered to name it in a
 * `delete`. An allow-list inverts the default, so a new column is invisible
 * here until someone adds it deliberately.
 *
 * Notably NOT here, and each for its own reason:
 *  - `email`, `claimed_by_user_id` — contact/account PII, never public. Note
 *    `email` is not in GLOBAL_PERSON_NULLED either, so it SURVIVES a GDPR
 *    erasure; this list is what keeps it off the public profile.
 *  - `merged_into_id`, `deleted_at` — merge bookkeeping. The reads filter on
 *    them rather than publishing them.
 *  - `is_fighter` / `is_referee` / `is_workshop_participant` / `is_instructor`
 *    / `is_referee_event_managed` — role flags. No public surface renders them.
 *  - `created_at` / `updated_at` — when a row was typed into an import.
 *
 * Two columns are SELECTED but never emitted — the projection consumes them and
 * publishes something else:
 *  - `public_visibility` decides what to hide. Omitting it from the query would
 *    make the map `{}` for every fighter and silently republish every field
 *    anybody chose to hide.
 *  - `account_deleted_at` becomes the boolean `accountDeleted`. The profile page
 *    only branches on whether the account was erased; it never renders the date,
 *    so an exact erasure timestamp for a named person was more than any reader
 *    needed.
 */
const PUBLIC_FIGHTER_EMITTED_FIELDS = [
  'id',
  'slug',
  'display_name',
  'given_name',
  'family_name',
  'club_id',
  'photo_url',
  'hema_ratings_id',
  // Everything from here down is visibility-gated (see VISIBILITY_FIELDS): it
  // must be SELECTED so the gate has something to withhold.
  'country_code',
  'gender_category',
  'date_of_birth',
  'bio',
  'alias',
  'website_url',
  'instagram_url',
  'youtube_url',
  'practicing_since_year',
] as const;

/** Read by the projection, never present in its output. */
const VISIBILITY_CONFIG_FIELD = 'public_visibility';
const ACCOUNT_ERASED_FIELD = 'account_deleted_at';

const PUBLIC_FIGHTER_COLUMNS = [
  ...PUBLIC_FIGHTER_EMITTED_FIELDS,
  VISIBILITY_CONFIG_FIELD,
  ACCOUNT_ERASED_FIELD,
].join(', ');

/**
 * Columns GET /global-persons returns to any authenticated caller.
 *
 * Scoped to what the three organiser pickers actually read — the participant
 * picker via `mapGlobalPersonSuggestion`, the referee picker and the workshop
 * picker. Nothing here is contact PII, so an organiser adding someone to their
 * event learns nothing they could not already see on the public profile.
 */
const GLOBAL_PERSON_PICKER_COLUMNS = [
  'id',
  'slug',
  'display_name',
  'given_name',
  'family_name',
  'club_id',
  'hema_ratings_id',
  'photo_url',
  'is_fighter',
  'is_referee',
  'is_workshop_participant',
  'is_instructor',
].join(', ');

/**
 * Added only for platform staff, who administer these records.
 *
 * `email` and `date_of_birth` are contact PII. `bio`, `gender_category` and
 * `country_code` are visibility-gated on the public profile
 * (see VISIBILITY_FIELDS) and this endpoint does NOT apply that gate, so
 * handing them to every signed-in caller would route around a fighter's own
 * choice to hide them. The super-admin console renders all five.
 */
const GLOBAL_PERSON_STAFF_COLUMNS = [
  'email',
  'date_of_birth',
  'bio',
  'gender_category',
  'country_code',
  'merged_into_id',
  'deleted_at',
].join(', ');

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
    // construct the service without it — placement computation degrades to an
    // empty map rather than throwing.
    private readonly placement?: TournamentPlacementService,
    // Optional like the two above: only getBySlug needs it, and it degrades to
    // the existing 404 rather than throwing when absent.
    private readonly erasure?: ErasureService,
  ) {}

  // ── List ────────────────────────────────────────────────────────────────────

  async list(query: FighterQueryDto) {
    // Typo-tolerant search: when a free-text query is present (and we're not also
    // filtering by club), rank by trigram similarity via lookup_global_persons,
    // then hydrate full rows in that order. Falls back to ilike when the RPC is
    // unavailable or returns nothing.
    const limit = Math.min(query.limit ?? DEFAULT_FIGHTER_PAGE, MAX_FIGHTER_PAGE);
    const offset = query.offset ?? 0;

    const term = query.q?.trim();
    if (term && term.length >= 2 && !query.club) {
      // The fuzzy branch honours `limit` but has no offset: lookup_global_persons
      // takes p_limit only, so page 2 of a fuzzy search is not expressible. The
      // directory's own RPC (search_public_fighters) is where that is fixed;
      // here the branch is a typo-tolerant first page, as it always was.
      const fuzzy = await this.fuzzySearchFighters(term, limit);
      if (fuzzy) return fuzzy;
    }

    let q = applyReachable(
      this.supabase.service
        .from('global_persons')
        .select(`${PUBLIC_FIGHTER_COLUMNS}, clubs(name, slug)`),
    )
      .order('family_name', { ascending: true })
      .order('given_name', { ascending: true })
      // Unbounded before this: with no query at all, GET /fighters selected
      // every global_persons row and its club embed in one response.
      .range(offset, offset + limit - 1);

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
    // Through `unknown`: supabase-js parses the select string at the TYPE level,
    // and the allow-list is joined at runtime, so it can only infer ParserError.
    // Same reason `listGlobalPersons` returns its rows untyped.
    return ((data ?? []) as unknown as Row[]).map((row) => this.sanitizePublicFighter(row));
  }

  /** Trigram-ranked fighter search. Returns full rows (same shape as list())
   *  ordered by similarity, or null to signal the caller to fall back to ilike. */
  private async fuzzySearchFighters(term: string, limit: number): Promise<Row[] | null> {
    const { data, error } = await this.supabase.service.rpc('lookup_global_persons', {
      p_query: term,
      p_limit: limit,
      p_threshold: 0.2,
    });
    if (error || !data) return null; // pre-migration / RPC error → ilike fallback

    const ranked = data as Array<{ id: string }>;
    if (ranked.length === 0) return []; // ran cleanly, genuinely no matches

    const ids = ranked.map((r) => r.id);
    // The predicate is re-applied here, not trusted from the RPC. An id list is
    // not a promise about the rows behind it, and lookup_global_persons filters
    // on only two of the three columns — it has never excluded erased accounts.
    // Without this the fuzzy branch and the ilike branch return different row
    // sets for the same conceptual query, decided by the length of the term.
    const { data: rows } = await applyReachable(
      this.supabase.service
        .from('global_persons')
        .select(`${PUBLIC_FIGHTER_COLUMNS}, clubs(name, slug)`),
    ).in('id', ids);

    const order = new Map(ids.map((id, index) => [id, index]));
    return ((rows ?? []) as unknown as Row[])
      .sort((a, b) => (order.get(a['id'] as string) ?? 0) - (order.get(b['id'] as string) ?? 0))
      .map((row) => this.sanitizePublicFighter(row));
  }

  // ── Get by slug ──────────────────────────────────────────────────────────────

  async getBySlug(slug: string) {
    const { data, error } = await applyReachable(
      this.supabase.service
        .from('global_persons')
        .select(`${PUBLIC_FIGHTER_COLUMNS}, clubs(name, slug, city, country_code)`),
    )
      .eq('slug', slug)
      .maybeSingle();

    if (error) throw new BadRequestException(error.message);
    if (!data) {
      // A slug retired by a super-admin anonymisation is GONE, not merely
      // absent. 410 is the correct semantic and search engines drop it faster
      // than a 404 — which is the point when the reason for anonymising was a
      // cached result carrying the person's name.
      if (this.erasure && (await this.erasure.isRetiredSlug(slug))) {
        throw new GoneException('This profile has been removed');
      }
      throw new NotFoundException(`Fighter "${slug}" not found`);
    }

    const row = data as unknown as Record<string, unknown>;
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

  /** Public HEMA rating time-series for the ranking-history chart. Empty when
   *  the fighter has no linked hema_ratings_id or the ratings service is absent. */
  async getRatingHistoryBySlug(slug: string) {
    const { data, error } = await this.supabase.service
      .from('global_persons')
      .select('hema_ratings_id')
      .eq('slug', slug)
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    const hemaRatingsId = (data as Row | null)?.['hema_ratings_id'] as string | null | undefined;
    if (!hemaRatingsId || !this.hemaRatings) return { series: [] };
    return { series: await this.hemaRatings.getRatingHistory(hemaRatingsId) };
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
    // Public-profile identity fields: trim and coerce blank → null so an emptied
    // input clears the column rather than storing '' (null-to-clear).
    if (dto.alias !== undefined) updates['alias'] = dto.alias?.trim() || null;
    if (dto.websiteUrl !== undefined) updates['website_url'] = dto.websiteUrl?.trim() || null;
    if (dto.instagramUrl !== undefined) updates['instagram_url'] = dto.instagramUrl?.trim() || null;
    if (dto.youtubeUrl !== undefined) updates['youtube_url'] = dto.youtubeUrl?.trim() || null;
    if (dto.practicingSinceYear !== undefined)
      updates['practicing_since_year'] = dto.practicingSinceYear ?? null;
    if (dto.publicVisibility !== undefined)
      updates['public_visibility'] = this.pickVisibilityKeys(dto.publicVisibility);
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

  async listWeapons(activeOnly = false) {
    let query = this.supabase.service.from('weapon_catalog').select('*');
    if (activeOnly) query = query.eq('active', true);
    const { data, error } = await query.order('name', { ascending: true });

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
      medals: await this.getFighterMedalLinks(String(row['id'])),
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
      alias: dto.alias,
      websiteUrl: dto.websiteUrl,
      instagramUrl: dto.instagramUrl,
      youtubeUrl: dto.youtubeUrl,
      practicingSinceYear: dto.practicingSinceYear,
      publicVisibility: dto.publicVisibility,
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
    if (dto.medals !== undefined) await this.replaceFighterMedals(dto.fighterId, dto.medals);

    return this.getMyProfile(userId);
  }

  // ── Profile photo ────────────────────────────────────────────────────────────

  /** Resolve the claimed user's global_persons id (throws if none linked). */
  private async resolveMyGlobalPersonId(userId: string): Promise<string> {
    const { data, error } = await this.supabase.service
      .from('global_persons')
      .select('id')
      .eq('claimed_by_user_id', userId)
      .maybeSingle();

    if (error) throw new BadRequestException(error.message);
    if (!data) throw new NotFoundException('No claimed Fighter profile linked to this account');
    return String((data as Row)['id']);
  }

  /**
   * Upload the claimed user's profile photo. Mirrors
   * OrganizationsService.uploadLogo (Fastify buffer → Supabase Storage →
   * same-origin path → save on the row), but writes to the dedicated
   * `fighter-photos` bucket at a 15 MB cap and stores the path on
   * `global_persons.photo_url`. We store a same-origin RELATIVE path (not
   * Supabase's absolute getPublicUrl) so the photo loads on every surface
   * that renders it — including the admin external-display popup, which is on
   * a different origin than the app the getPublicUrl would point at.
   */
  async uploadMyPhoto(userId: string, file: FighterPhotoUpload): Promise<{ url: string }> {
    const id = await this.resolveMyGlobalPersonId(userId);

    if (!file.buffer.length) throw new BadRequestException('No photo file uploaded.');
    if (file.buffer.length > FIGHTER_PHOTO_MAX_BYTES) {
      throw new BadRequestException('Photo upload exceeds the 15 MB size limit.');
    }
    if (!ALLOWED_FIGHTER_PHOTO_MIME_TYPES.has(file.mimetype)) {
      throw new BadRequestException('Photo upload must be a PNG, JPEG, or WebP image.');
    }

    await this.ensurePhotoBucket();
    const extension =
      file.mimetype === 'image/png' ? 'png' : file.mimetype === 'image/webp' ? 'webp' : 'jpg';
    const path = `fighters/${id}/photo-${Date.now()}.${extension}`;

    const { error } = await this.supabase.service.storage
      .from(FIGHTER_PHOTO_BUCKET)
      .upload(path, file.buffer, { contentType: file.mimetype, upsert: true });
    if (error) throw new BadRequestException(error.message);

    // Same-origin relative path — the IMG resolves to whichever admin/app
    // origin loaded the bundle, sidestepping the cross-origin app.${DOMAIN}
    // roundtrip Supabase's getPublicUrl would produce. Traefik routes
    // /storage/v1/* to supabase-storage on both origins. Mirrors
    // OrganizationsService.uploadLogo.
    const url = `/storage/v1/object/public/${FIGHTER_PHOTO_BUCKET}/${path}`;

    const { error: updateError } = await this.supabase.service
      .from('global_persons')
      .update({ photo_url: url, updated_at: new Date().toISOString() })
      .eq('id', id);
    if (updateError) throw new BadRequestException(updateError.message);

    return { url };
  }

  /** Clear the claimed user's profile photo (avatar falls back to initials). */
  async removeMyPhoto(userId: string): Promise<{ url: null }> {
    const id = await this.resolveMyGlobalPersonId(userId);
    const { error } = await this.supabase.service
      .from('global_persons')
      .update({ photo_url: null, updated_at: new Date().toISOString() })
      .eq('id', id);
    if (error) throw new BadRequestException(error.message);
    return { url: null };
  }

  private async ensurePhotoBucket(): Promise<void> {
    const storage = this.supabase.service.storage;
    const { data, error } = await storage.getBucket(FIGHTER_PHOTO_BUCKET);
    if (data && !error) return;
    const created = await storage.createBucket(FIGHTER_PHOTO_BUCKET, {
      public: true,
      fileSizeLimit: FIGHTER_PHOTO_MAX_BYTES,
      allowedMimeTypes: Array.from(ALLOWED_FIGHTER_PHOTO_MIME_TYPES),
    });
    if (created.error && !/already exists/iu.test(created.error.message)) {
      throw new BadRequestException(created.error.message);
    }
  }

  async getMyDashboard(userId: string) {
    const profile = await this.getMyProfile(userId);
    const personId = String((profile as Row)['id']);
    return {
      profile,
      career: await this.getCareerForFighter(personId, {}, { includePenalties: true }),
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

  async getCareerForFighter(
    fighterId: string,
    query: { year?: string; weapon?: string } = {},
    opts: { includePenalties?: boolean } = {},
  ) {
    const registrations = await this.fetchCareerRegistrations(fighterId, query);
    const registrationIds = registrations.map((registration) => registration.id);
    const matches =
      registrationIds.length > 0 ? await this.fetchCareerMatches(registrationIds) : [];
    const exchanges =
      matches.length > 0 ? await this.fetchCareerExchanges(matches.map((match) => match.id)) : [];
    const leagueRankings = await this.fetchCareerLeagueRankings(fighterId);
    // Only rank tournaments the fighter actually fought a completed match in.
    // Registration alone isn't enough (nothing to place), and this bounds the
    // per-tournament bracket/standings fetches below to real participation.
    const foughtRegistrationIds = new Set(
      matches
        .filter((match) => match.status === 'completed')
        .flatMap((match) => [match.redRegistrationId, match.blueRegistrationId])
        .filter((id): id is string => id != null),
    );
    const placementByRegistrationId = await this.computeTournamentPlacements(
      registrations.filter((registration) => foughtRegistrationIds.has(registration.id)),
    );
    // Cards received are private — only fetched for the fighter's own dashboard,
    // never the public `/fighters/:slug` career projection.
    const penalties =
      opts.includePenalties && registrationIds.length > 0
        ? await this.fetchFighterPenalties(registrationIds)
        : undefined;

    return buildFighterCareer({
      fighterId,
      registrations,
      matches,
      exchanges,
      leagueRankings,
      placementByRegistrationId,
      penalties,
    });
  }

  /**
   * For each tournament the fighter competed in, look up their final placement
   * from the shared `TournamentPlacementService` — the SAME `computeFinalRanking`
   * the public tournament page and league scoring use, so the number on the
   * profile matches the bracket. Best-effort per tournament: a failing lookup
   * leaves that placement unset rather than breaking dashboard load. The service
   * is optional (absent in some unit tests → no placements).
   *
   * Callers pass only registrations the fighter actually fought in. Whether a
   * placement is *awarded* turns on the tournament being decided (the service
   * returns `decided:false` until the Final is settled), never on
   * `tournaments.status` — nothing sets that to `completed` automatically.
   */
  private async computeTournamentPlacements(
    registrations: CareerRegistrationInput[],
  ): Promise<Map<string, TournamentPlacement>> {
    const placements = new Map<string, TournamentPlacement>();
    if (!this.placement) return placements;

    // Per-build memo — a fighter's registrations cluster onto a handful of
    // tournaments, so fetch each tournament's full-field placement once.
    const byTournament = new Map<string, Map<string, TournamentPlacement>>();
    for (const registration of registrations) {
      let byRegistrationId = byTournament.get(registration.tournamentId);
      if (!byRegistrationId) {
        try {
          const result = await this.placement.getTournamentPlacements(registration.tournamentId);
          byRegistrationId = result.byRegistrationId;
        } catch {
          // A single tournament's bracket/standings failing must never break the
          // whole career dashboard — skip and move on.
          byRegistrationId = new Map<string, TournamentPlacement>();
        }
        byTournament.set(registration.tournamentId, byRegistrationId);
      }
      const placement = byRegistrationId.get(registration.id);
      if (placement) placements.set(registration.id, placement);
    }
    return placements;
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

  /**
   * Project a global_persons row for public consumption. Applied to every
   * public read (getBySlug, list, fuzzy search).
   *
   * Two gates, in order:
   *  1. COPY the allow-listed columns across. This used to spread the whole row
   *     and `delete` three keys, which meant the function's output was defined
   *     by what the caller happened to pass in — so every new column was public
   *     by default and the projection could not be reasoned about in isolation.
   *     Building the result instead of pruning it makes the set of public
   *     fields a property of this file.
   *  2. Apply the fighter's own `public_visibility` map on top, dropping any
   *     column they marked hidden. Defaults: everything public except
   *     date_of_birth.
   *
   * The `clubs(...)` embed and the relations added by
   * `withPublicProfileRelations` are attached by the caller, AFTER this runs.
   */
  private sanitizePublicFighter(row: Row): Row {
    const vis = (row[VISIBILITY_CONFIG_FIELD] ?? {}) as Record<string, unknown>;

    const out: Row = {};
    for (const field of PUBLIC_FIGHTER_EMITTED_FIELDS) {
      if (field in row) out[field] = row[field];
    }
    // PostgREST returns an embed under its relation name, which is not a column
    // and so is not in the allow-list. Carry it through when the query asked for
    // it; the embed itself is column-scoped at the call site.
    if ('clubs' in row) out['clubs'] = row['clubs'];
    // Derived, not copied: the reader needs to know the account was erased, not
    // when. See PUBLIC_FIGHTER_COLUMNS.
    out['accountDeleted'] = row[ACCOUNT_ERASED_FIELD] != null;

    for (const [key, cfg] of Object.entries(VISIBILITY_FIELDS)) {
      const explicit = typeof vis[key] === 'boolean' ? (vis[key] as boolean) : undefined;
      const visible = explicit ?? cfg.defaultPublic;
      if (!visible) for (const col of cfg.columns) delete out[col];
    }
    return out;
  }

  /** Keep only known visibility keys with boolean values before persisting. */
  private pickVisibilityKeys(input: Record<string, unknown>): Record<string, boolean> {
    const out: Record<string, boolean> = {};
    for (const key of Object.keys(VISIBILITY_FIELDS)) {
      if (typeof input[key] === 'boolean') out[key] = input[key] as boolean;
    }
    return out;
  }

  private async withPublicProfileRelations(row: Row): Promise<Row> {
    const id = String(row['id']);
    return {
      ...row,
      clubs: await this.getFighterClubLinks(id),
      weapons: await this.getFighterWeaponLinks(id),
      // Manual/imported podiums are publicly readable (RLS grants SELECT); surface
      // them by slug so the shared stats panel shows the same medals as /me. Returns
      // [] gracefully if the fighter_manual_medals table isn't present yet.
      medals: await this.getFighterMedalLinks(id),
      // Live + recent completed matches for the profile's "recent results" strip.
      recentMatches: await this.getRecentMatchesForProfile(id),
    };
  }

  /** Recent live + completed matches for the public profile "recent results"
   *  strip. Test-event matches are excluded (career-consistent), and completed
   *  matches are capped at a small preview — the full history lives behind the
   *  "show all matches" modal (getPaginatedMatches). Each match carries the
   *  winner-aware outcome so a draw is never mislabelled as a loss. */
  private async getRecentMatchesForProfile(fighterId: string): Promise<ProfileRecentMatch[]> {
    // registrations has no global_person_id (dropped in 0083) — walk through
    // person_id → persons.global_person_id, as the paginated match path does.
    const { data: regData, error: regError } = await this.supabase.service
      .from('registrations')
      .select(
        'id, persons!inner(global_person_id), tournaments(events(id, name, slug, event_kind))',
      )
      .eq('persons.global_person_id', fighterId);
    if (regError || !regData) return [];

    const registrations = (regData as Row[]).filter((reg) => {
      const tournament = reg['tournaments'] as Row | null;
      const event = tournament?.['events'] as Row | null;
      return countsTowardStats(asEventKind(event?.['event_kind']));
    });
    if (registrations.length === 0) return [];

    const regById = new Map<string, Row>();
    const ownRegistrationIds = new Set<string>();
    for (const reg of registrations) {
      const regId = String(reg['id']);
      regById.set(regId, reg);
      ownRegistrationIds.add(regId);
    }

    const ids = [...ownRegistrationIds].join(',');
    const orFilter = `red_registration_id.in.(${ids}),blue_registration_id.in.(${ids})`;
    const columns =
      'id, status, scheduled_at, created_at, match_number_label, red_registration_id, blue_registration_id, winner_registration_id, red_score, blue_score';

    // Running matches (usually 0–1) plus the most recent completed ones.
    const [liveRes, completedRes] = await Promise.all([
      this.supabase.service.from('matches').select(columns).or(orFilter).eq('status', 'running'),
      this.supabase.service
        .from('matches')
        .select(columns)
        .or(orFilter)
        .eq('status', 'completed')
        .order('scheduled_at', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false })
        .limit(RECENT_COMPLETED_LIMIT),
    ]);

    const matchRows = [...((liveRes.data ?? []) as Row[]), ...((completedRes.data ?? []) as Row[])];
    if (matchRows.length === 0) return [];

    // Opponent display names — the registration NOT owned by this fighter.
    const opponentRegIds = new Set<string>();
    for (const match of matchRows) {
      const redId = (match['red_registration_id'] as string | null) ?? null;
      const blueId = (match['blue_registration_id'] as string | null) ?? null;
      if (redId && !ownRegistrationIds.has(redId)) opponentRegIds.add(redId);
      if (blueId && !ownRegistrationIds.has(blueId)) opponentRegIds.add(blueId);
    }
    const opponentNames = new Map<string, string>();
    if (opponentRegIds.size > 0) {
      const { data: oppData } = await this.supabase.service
        .from('registrations')
        .select('id, persons(global_persons(display_name))')
        .in('id', [...opponentRegIds]);
      for (const row of (oppData ?? []) as Row[]) {
        const person = row['persons'] as Row | null;
        const gp = person?.['global_persons'] as Row | null;
        opponentNames.set(String(row['id']), String(gp?.['display_name'] ?? ''));
      }
    }

    return matchRows.map((match) => {
      const redId = (match['red_registration_id'] as string | null) ?? null;
      const blueId = (match['blue_registration_id'] as string | null) ?? null;
      // Event context comes from the fighter's OWN registration on this match.
      const myRegId = redId && ownRegistrationIds.has(redId) ? redId : blueId;
      const myReg = myRegId ? regById.get(myRegId) : null;
      const tournament = (myReg?.['tournaments'] as Row | null) ?? null;
      const event = (tournament?.['events'] as Row | null) ?? null;
      const rowInput: RecentMatchRow = {
        id: String(match['id']),
        status: String(match['status']),
        scheduledAt: (match['scheduled_at'] as string | null) ?? null,
        matchNumberLabel: (match['match_number_label'] as string | null) ?? null,
        redRegistrationId: redId,
        blueRegistrationId: blueId,
        winnerRegistrationId: (match['winner_registration_id'] as string | null) ?? null,
        redScore: Number(match['red_score'] ?? 0),
        blueScore: Number(match['blue_score'] ?? 0),
        eventName: String(event?.['name'] ?? ''),
        eventSlug: String(event?.['slug'] ?? ''),
      };
      return buildProfileRecentMatch(rowInput, ownRegistrationIds, opponentNames);
    });
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
      .select('favorite, sort_order, level, style, weapon_catalog(id, slug, name)')
      .eq('global_person_id', fighterId)
      .order('favorite', { ascending: false })
      .order('sort_order', { ascending: true });

    if (error) return [];
    return data ?? [];
  }

  private async getFighterMedalLinks(fighterId: string) {
    const { data, error } = await this.supabase.service
      .from('fighter_manual_medals')
      .select('competition, year, rank, weapon')
      .eq('global_person_id', fighterId)
      .order('year', { ascending: false })
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
      style?: string | null;
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
        style: weapon.style?.trim() || null,
        sort_order: index,
      });
    }
    if (rows.length === 0) return;
    const { error } = await this.supabase.service.from('fighter_weapons').insert(rows);
    if (error) throw new BadRequestException(error.message);
  }

  private async replaceFighterMedals(
    fighterId: string,
    medals: Array<{ competition: string; year: number; rank: number; weapon: string }>,
  ): Promise<void> {
    await this.supabase.service
      .from('fighter_manual_medals')
      .delete()
      .eq('global_person_id', fighterId);
    const rows: Row[] = medals.map((medal, index) => ({
      global_person_id: fighterId,
      competition: medal.competition,
      year: medal.year,
      rank: medal.rank,
      weapon: medal.weapon,
      sort_order: index,
    }));
    if (rows.length === 0) return;
    const { error } = await this.supabase.service.from('fighter_manual_medals').insert(rows);
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
          events ( id, name, slug, status, start_date, end_date, event_kind )
        )
      `,
      )
      // registrations has no global_person_id (legacy fighter_id dropped in 0083);
      // identity flows through person_id → persons.global_person_id.
      .eq('persons.global_person_id', fighterId);
    if (query.weapon) request = request.eq('tournaments.weapon', query.weapon) as typeof request;

    const { data, error } = await request;
    if (error) throw new BadRequestException(error.message);

    return (
      ((data ?? []) as Row[])
        // Only STANDARD results count toward a fighter's public career stats —
        // test events are dry runs and club events are internal activity.
        // Filtering registrations cascades: career matches/placements derive
        // from this set, and league rankings are already gated (league gate).
        .filter((row) => {
          const tournament = row['tournaments'] as Row | null;
          const event = tournament?.['events'] as Row | null;
          return countsTowardStats(asEventKind(event?.['event_kind']));
        })
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
        .filter(
          (registration) => !query.year || registration.eventStartDate?.startsWith(query.year),
        )
    );
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
      .select(
        'rank, total_points, medal_count, ranking_group_key, leagues(name, slug, public_visibility, status)',
      )
      .eq('global_person_id', fighterId);
    if (error) return [];

    // Only published+public leagues — these are the ones with a live classement
    // the profile tile can deep-link into (matches /api/v1/me/leagues).
    return ((data ?? []) as Row[]).flatMap((row) => {
      const league = row['leagues'] as Row | null;
      if (!league || league['public_visibility'] !== true || league['status'] !== 'published') {
        return [];
      }
      return [
        {
          leagueName: String(league['name'] ?? ''),
          leagueSlug: String(league['slug'] ?? ''),
          rank: Number(row['rank'] ?? 0),
          totalPoints: Number(row['total_points'] ?? 0),
          medalCount: Number(row['medal_count'] ?? 0),
          group: String(row['ranking_group_key'] ?? ''),
        },
      ];
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
    const matchFightersByMatchId = includePrivateDetails
      ? await this.fetchMatchFightersByMatch(matchIds)
      : undefined;

    return buildRefereeStats({
      userId: personId,
      assignments: allAssignments,
      durations,
      penalties,
      buddiesByUserId,
      includePrivateDetails,
      skillsByRole,
      matchFightersByMatchId,
    });
  }

  /**
   * Batched match_id → per-side fighter name, score and the winning side.
   * Resolves matches → registrations → persons → global_persons (same "Given
   * Family" with global display-name fallback pattern as public-schedule's
   * resolveRegistrationNames). Used only on the private `/me` referee path.
   *
   * The winner is derived from `winner_registration_id`, never by comparing
   * scores — a forfeit or a walkover can be won on a lower score, and a draw
   * has equal scores with no winner at all.
   */
  private async fetchMatchFightersByMatch(matchIds: string[]): Promise<Map<string, MatchFighters>> {
    const result = new Map<string, MatchFighters>();
    if (matchIds.length === 0) return result;

    const { data: matchRows } = await this.supabase.service
      .from('matches')
      .select(
        'id, red_registration_id, blue_registration_id, red_score, blue_score, winner_registration_id',
      )
      .in('id', matchIds);
    const matches = (matchRows ?? []) as Row[];

    const regIds = [
      ...new Set(
        matches
          .flatMap((row) => [row['red_registration_id'], row['blue_registration_id']])
          .filter((id): id is string => typeof id === 'string' && id.length > 0),
      ),
    ];
    const namesByReg = await this.fetchNamesByRegistration(regIds);

    for (const row of matches) {
      const redReg = row['red_registration_id'] as string | null;
      const blueReg = row['blue_registration_id'] as string | null;
      const winnerReg = row['winner_registration_id'] as string | null;
      result.set(String(row['id']), {
        redName: redReg ? (namesByReg.get(redReg) ?? null) : null,
        blueName: blueReg ? (namesByReg.get(blueReg) ?? null) : null,
        redScore: Number(row['red_score'] ?? 0),
        blueScore: Number(row['blue_score'] ?? 0),
        winner:
          winnerReg && winnerReg === redReg
            ? 'red'
            : winnerReg && winnerReg === blueReg
              ? 'blue'
              : null,
      });
    }
    return result;
  }

  /**
   * Batched registration_id → fighter display name, resolving
   * registrations → persons → global_persons. Prefers the local "Given Family"
   * and falls back to the global display name — the same pattern as
   * public-schedule's resolveRegistrationNames. Registrations whose name can't
   * be resolved are simply absent from the map.
   */
  private async fetchNamesByRegistration(regIds: string[]): Promise<Map<string, string>> {
    const namesByReg = new Map<string, string>();
    if (regIds.length === 0) return namesByReg;

    const { data: regRows } = await this.supabase.service
      .from('registrations')
      .select('id, persons ( given_name, family_name, global_persons ( display_name ) )')
      .in('id', regIds);
    for (const row of (regRows ?? []) as Row[]) {
      const personRaw = row['persons'];
      const person = (Array.isArray(personRaw) ? personRaw[0] : personRaw) as Row | null;
      if (!person) continue;
      const given = String(person['given_name'] ?? '').trim();
      const family = String(person['family_name'] ?? '').trim();
      const gpRaw = person['global_persons'];
      const gp = (Array.isArray(gpRaw) ? gpRaw[0] : gpRaw) as { display_name?: string } | null;
      const name = `${given} ${family}`.trim() || (gp?.display_name ?? '').trim();
      if (name) namesByReg.set(String(row['id']), name);
    }
    return namesByReg;
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
        'match_id, person_id, role, matches(id, status, scheduled_at, pool_id, bracket_slot_id, pools(sort_order), bracket_slots(round), phases(type, config_json, tournaments(id, name, weapon, scoring_config_json, events(id, name, event_kind))))',
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
        'match_id, person_id, role, matches(id, status, scheduled_at, pool_id, bracket_slot_id, pools(sort_order), bracket_slots(round), phases(type, config_json, tournaments(id, name, weapon, scoring_config_json, events(id, name, event_kind))))',
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
        // Only STANDARD work counts toward a referee's cross-event career stats
        // — mirrors the fighter career exclusion (fetchCareerRegistrations), so
        // test AND club events are both dropped. Scoped to the profile/career
        // path; per-event stats (event-stats.service) intentionally still
        // include every kind, per the 0129 precedent.
        if (!countsTowardStats(asEventKind(event?.['event_kind']))) return null;
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
          // Carried per assignment: a referee's history spans tournaments, each
          // with its own configured side colours. Without this the profile had
          // nothing to resolve and fell back to red/blue.
          sideColors: sideColorsFromScoringConfig(tournament?.['scoring_config_json']),
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

  /** Cards a fighter RECEIVED, keyed to their career registrations (private
   *  `/me` dashboard only). `category` coalesces the ruleset entry's snapshotted
   *  `short_name` with a manual card's free-text `reason`. Voided cards are
   *  excluded at the query level. Best-effort: any error yields no penalties
   *  rather than breaking dashboard load. */
  private async fetchFighterPenalties(registrationIds: string[]): Promise<CareerPenaltyInput[]> {
    const { data, error } = await this.supabase.service
      .from('match_penalties')
      .select('registration_id, card, short_name, reason, voided')
      .in('registration_id', registrationIds)
      .eq('voided', false);
    if (error) return [];
    return ((data ?? []) as Row[]).map((row) => {
      const shortName = (row['short_name'] as string | null) ?? null;
      const reason = (row['reason'] as string | null) ?? null;
      return {
        registrationId: String(row['registration_id']),
        card: String(row['card']),
        category: shortName ?? reason,
      };
    });
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

  async listGlobalPersons(query: GlobalPersonQueryDto, opts: { includeContactPii?: boolean } = {}) {
    // An ALLOW-list, not `select('*')`. The previous query returned the whole
    // row, so every column ever added to global_persons shipped to the caller on
    // the day it landed — email (0075), date_of_birth, claimed_by_user_id and
    // public_visibility (0126) all did. An allow-list fails CLOSED: a new column
    // is invisible here until someone adds it deliberately.
    const columns = opts.includeContactPii
      ? `${GLOBAL_PERSON_PICKER_COLUMNS}, ${GLOBAL_PERSON_STAFF_COLUMNS}`
      : GLOBAL_PERSON_PICKER_COLUMNS;

    let q = this.supabase.service
      .from('global_persons')
      .select(`${columns}, clubs(id, name, slug, abbreviation, city, country_code)`)
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
      isInstructor: dto.isInstructor,
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
        is_instructor: dto.isInstructor ?? false,
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
      isInstructor: dto.isInstructor ?? Boolean(row['is_instructor']),
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
    if (dto.isInstructor !== undefined) updates['is_instructor'] = dto.isInstructor;
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
        genderCategory: string | null;
        weapons: string | null;
        isFighter: boolean;
        isReferee: boolean;
        isWorkshopParticipant: boolean;
        isInstructor: boolean;
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
          genderCategory: null,
          weapons: null,
          isFighter: false,
          isReferee: false,
          isWorkshopParticipant: false,
          isInstructor: false,
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
          genderCategory: row.gender_category ?? null,
          weapons: row.weapons ?? null,
          isFighter: parseBoolCell(row.is_fighter),
          isReferee: parseBoolCell(row.is_referee),
          isWorkshopParticipant: parseBoolCell(row.is_workshop_participant),
          // CSV import has no is_instructor column yet — instructors are set via
          // event tagging (auto-tick) or the admin role checkbox.
          isInstructor: false,
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
        gender_category: decision.genderCategory?.trim() || null,
        is_fighter: decision.isFighter ? 'true' : 'false',
        is_referee: decision.isReferee ? 'true' : 'false',
        is_workshop_participant: decision.isWorkshopParticipant ? 'true' : 'false',
        is_instructor: decision.isInstructor ? 'true' : 'false',
      };

      try {
        let globalPersonId: string | null = null;
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
          globalPersonId = decision.targetGlobalPersonId;
          updated++;
        } else {
          const baseSlug = slugify(displayName);
          const slug = `${baseSlug}-${Date.now().toString(36)}`;
          const { data, error } = await this.supabase.service
            .from('global_persons')
            .insert({ slug, ...payload })
            .select('id')
            .single();
          if (error) {
            failed.push({ index: decision.index, reason: error.message });
            continue;
          }
          globalPersonId = data ? String((data as Row)['id']) : null;
          created++;
        }
        // Weapons live on global_persons via fighter_weapons; a blank cell is a
        // no-op, so it never clears a profile's existing weapons.
        if (globalPersonId && decision.weapons) {
          await replaceFighterWeaponsFromCell(
            this.supabase.service as never,
            globalPersonId,
            decision.weapons,
          );
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
    isInstructor?: boolean;
  }): void {
    if (
      !roles.isFighter &&
      !roles.isReferee &&
      !roles.isWorkshopParticipant &&
      !roles.isInstructor
    ) {
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

  async linkRefereeQualification(qualificationId: string, globalPersonId: string) {
    const { error } = await this.supabase.service
      .from('referee_qualifications')
      .update({ global_person_id: globalPersonId })
      .eq('id', qualificationId)
      .is('global_person_id', null);

    if (error) throw new BadRequestException(error.message);
  }

  async linkWorkshopEnrollment(enrollmentId: string, globalPersonId: string) {
    // An instructor holds no participant seat in a workshop they teach
    // (enforced on self-enrollment in EnrollmentService.enroll). Linking an
    // orphan enrollment to that workshop's instructor would recreate exactly
    // that state through the back door, so reject it here too.
    if (await this.enrollmentIsTaughtBy(enrollmentId, globalPersonId)) {
      throw new ForbiddenException(
        'This person teaches the workshop — they cannot be linked to an enrollment in it.',
      );
    }

    const { error } = await this.supabase.service
      .from('workshop_enrollments')
      .update({ global_person_id: globalPersonId })
      .eq('id', enrollmentId)
      .is('global_person_id', null);

    if (error) throw new BadRequestException(error.message);
  }

  /** True when `globalPersonId` is a listed instructor of the enrollment's workshop. */
  private async enrollmentIsTaughtBy(
    enrollmentId: string,
    globalPersonId: string,
  ): Promise<boolean> {
    const { data: enrollment } = await this.supabase.service
      .from('workshop_enrollments')
      .select('workshop_sessions ( workshop_id )')
      .eq('id', enrollmentId)
      .maybeSingle();

    // UNIQUE(workshop_id) on workshop_sessions (migration 0098) makes PostgREST
    // embed the parent as an object, but it can still arrive as an array.
    const raw = (enrollment as { workshop_sessions?: unknown } | null)?.workshop_sessions;
    const session = (Array.isArray(raw) ? raw[0] : raw) as { workshop_id?: string | null } | null;
    const workshopId = session?.workshop_id ?? null;
    if (!workshopId) return false;

    const { data } = await this.supabase.service
      .from('workshop_instructors')
      .select('id')
      .eq('workshop_id', workshopId)
      .eq('global_person_id', globalPersonId)
      .maybeSingle(); // UNIQUE(workshop_id, global_person_id) — migration 0103

    return Boolean(data);
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
