import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { sanitizePostgrestFilterValue } from '../../common/postgrest-filter';
import { SupabaseService } from '../supabase/supabase.service';
import { Public } from '../../common/auth/public.decorator';
import { CsvImportService } from './csv-import.service';

// Query DTO: values arrive as strings. `limit` is kept as a string because the
// handler parses it via parseInt(query.limit, 10); coercing to a number here
// would break that call site.
const lookupQuerySchema = z
  .object({
    q: z.string().max(100).optional(),
    limit: z.string().optional(),
  })
  .strict();
class LookupQueryDto extends createZodDto(lookupQuerySchema) {}

export interface LookupResult {
  id: string;
  given_name: string;
  family_name: string;
  club_label: string | null;
  masked_email: string;
  claimed_by_user_id: string | null;
  /**
   * The participant's global identity. Post-the participant-create
   * matcher, every persons row has one; nullable here only for legacy
   * rows that pre-date the change (drained on fresh deploys). Callers
   * that need cross-event identity (referees, ratings) key off this,
   * not on `claimed_by_user_id` (an auth user link, not a global id).
   */
  global_person_id: string | null;
}

// Public person/club lookup used by the public site's search.
@Public()
@ApiTags('persons')
@Controller()
export class LookupController {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly csv: CsvImportService,
  ) {}

  /**
   * GET /api/v1/events/:eventId/persons/lookup?q=...
   *
   * Public fuzzy name search — used by the participant onboarding screen
   * ("type your name to find yourself in the roster").
   *
   * Rate limited: 30 req/min per IP (global throttler override below).
   *
   * Returns max 10 results sorted by similarity desc.
   * Email is always masked.
   */
  @Get('events/:eventId/persons/lookup')
  @Throttle({ global: { limit: 30, ttl: 60_000 } })
  @ApiOperation({ summary: 'Fuzzy person name lookup (public)' })
  @ApiParam({ name: 'eventId', type: 'string', format: 'uuid' })
  @ApiQuery({ name: 'q', type: 'string', description: 'Search query (name)' })
  @ApiQuery({
    name: 'limit',
    type: 'number',
    required: false,
    description: 'Max results (default 10)',
  })
  @ApiResponse({ status: 200, description: 'Matching persons (masked email)' })
  @ApiResponse({ status: 400, description: 'Missing or invalid query' })
  async lookup(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Query() query: LookupQueryDto,
  ): Promise<LookupResult[]> {
    const q = (query.q ?? '').trim();
    // Empty query = "show me all participants" (used by typeahead on focus).
    // Caller can request up to 50 in that case; with a query we still cap at 10
    // because the trigram RPC isn't useful past the top matches.
    const limit = Math.min(
      parseInt(query.limit ?? (q ? '10' : '50'), 10) || (q ? 10 : 50),
      q ? 10 : 50,
    );
    if (!q) {
      return this.listAllParticipants(eventId, limit);
    }

    // Call the lookup_persons Postgres function (defined in 0003_lookup_functions.sql)
    const { data, error } = await this.supabase.service.rpc('lookup_persons', {
      p_event_id: eventId,
      p_query: q,
      p_limit: limit,
      p_threshold: 0.3,
    });

    if (error) {
      // Graceful fallback: if the function doesn't exist yet (pre-migration),
      // fall back to a simple ilike search
      return this.fallbackSearch(eventId, q, limit);
    }

    const rpcRows = data as Array<{
      id: string;
      given_name: string;
      family_name: string;
      club_label: string | null;
      masked_email: string;
    }>;

    // The lookup_persons RPC does not project claimed_by_user_id or
    // global_person_id. Fetch both in a single supplemental query.
    const ids = rpcRows.map((r) => r.id);
    const metaMap = await this.fetchPersonsMeta(ids);

    return rpcRows.map((row) => {
      const meta = metaMap.get(row.id);
      return {
        id: row.id,
        given_name: row.given_name,
        family_name: row.family_name,
        club_label: row.club_label ?? null,
        masked_email: row.masked_email,
        claimed_by_user_id: meta?.claimed_by_user_id ?? null,
        global_person_id: meta?.global_person_id ?? null,
      };
    });
  }

  /** Fallback when pg_trgm function not yet available (pre-migration). */
  private async fallbackSearch(eventId: string, q: string, limit: number): Promise<LookupResult[]> {
    // Strip PostgREST `.or()` meta-characters before interpolation — same
    // injection risk as the global fighter search.
    const safe = sanitizePostgrestFilterValue(q);
    if (!safe) return [];
    const { data } = await this.supabase.service
      .from('persons')
      .select(
        'id, given_name, family_name, email, claimed_by_user_id, global_person_id, clubs(name)',
      )
      .eq('event_id', eventId)
      .or(`given_name.ilike.%${safe}%,family_name.ilike.%${safe}%`)
      .limit(limit);

    return (data ?? []).map((p) => {
      const row = p as unknown as {
        id: string;
        given_name: string;
        family_name: string;
        email: string | null;
        claimed_by_user_id: string | null;
        global_person_id: string | null;
        clubs: { name: string } | null;
      };
      return {
        id: row.id,
        given_name: row.given_name,
        family_name: row.family_name,
        club_label: row.clubs?.name ?? null,
        masked_email: this.csv.maskEmail(row.email),
        claimed_by_user_id: row.claimed_by_user_id ?? null,
        global_person_id: row.global_person_id ?? null,
      };
    });
  }

  /**
   * Fetches claimed_by_user_id + global_person_id for a list of
   * persons.id values. Returns a Map keyed by person id.
   * Gracefully returns an empty map on error (non-fatal for the lookup).
   */
  private async fetchPersonsMeta(
    ids: string[],
  ): Promise<Map<string, { claimed_by_user_id: string | null; global_person_id: string | null }>> {
    if (ids.length === 0) return new Map();

    const { data } = await this.supabase.service
      .from('persons')
      .select('id, claimed_by_user_id, global_person_id')
      .in('id', ids);

    const map = new Map<
      string,
      { claimed_by_user_id: string | null; global_person_id: string | null }
    >();
    for (const row of data ?? []) {
      const r = row as {
        id: string;
        claimed_by_user_id: string | null;
        global_person_id: string | null;
      };
      map.set(r.id, {
        claimed_by_user_id: r.claimed_by_user_id ?? null,
        global_person_id: r.global_person_id ?? null,
      });
    }
    return map;
  }

  /**
   * Returns up to `limit` participants for the event, sorted by family then
   * given name. Used by typeahead inputs that want to show options on focus
   * before the user has typed anything.
   */
  private async listAllParticipants(eventId: string, limit: number): Promise<LookupResult[]> {
    const { data } = await this.supabase.service
      .from('persons')
      .select(
        'id, given_name, family_name, email, claimed_by_user_id, global_person_id, clubs(name)',
      )
      .eq('event_id', eventId)
      .order('family_name', { ascending: true })
      .order('given_name', { ascending: true })
      .limit(limit);

    return (data ?? []).map((p) => {
      const row = p as unknown as {
        id: string;
        given_name: string;
        family_name: string;
        email: string | null;
        claimed_by_user_id: string | null;
        global_person_id: string | null;
        clubs: { name: string } | null;
      };
      return {
        id: row.id,
        given_name: row.given_name,
        family_name: row.family_name,
        club_label: row.clubs?.name ?? null,
        masked_email: this.csv.maskEmail(row.email),
        claimed_by_user_id: row.claimed_by_user_id ?? null,
        global_person_id: row.global_person_id ?? null,
      };
    });
  }
}
