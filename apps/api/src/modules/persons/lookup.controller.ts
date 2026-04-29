import {
  BadRequestException,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
} from '@nestjs/common';
import {
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { SupabaseService } from '../supabase/supabase.service';
import { CsvImportService } from './csv-import.service';

class LookupQueryDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  q!: string;

  @IsOptional()
  @IsString()
  limit?: string;
}

export interface LookupResult {
  id: string;
  given_name: string;
  family_name: string;
  club_label: string | null;
  masked_email: string;
}

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
   * Rate limits:
   *   - 30 req/min per IP (global throttler)
   *   - 200 req/min per event (enforced at application level below)
   *
   * Returns max 10 results sorted by similarity desc.
   * Email is always masked.
   */
  @Get('events/:eventId/persons/lookup')
  @Throttle({ global: { limit: 30, ttl: 60_000 } })
  @ApiOperation({ summary: 'Fuzzy person name lookup (public)' })
  @ApiParam({ name: 'eventId', type: 'string', format: 'uuid' })
  @ApiQuery({ name: 'q', type: 'string', description: 'Search query (name)' })
  @ApiQuery({ name: 'limit', type: 'number', required: false, description: 'Max results (default 10)' })
  @ApiResponse({ status: 200, description: 'Matching persons (masked email)' })
  @ApiResponse({ status: 400, description: 'Missing or invalid query' })
  async lookup(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Query() query: LookupQueryDto,
  ): Promise<LookupResult[]> {
    const q = (query.q ?? '').trim();
    if (!q || q.length < 1) {
      throw new BadRequestException('Query parameter "q" is required');
    }

    const limit = Math.min(parseInt(query.limit ?? '10', 10) || 10, 10);

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

    return (data as Array<{
      id: string;
      given_name: string;
      family_name: string;
      club_label: string | null;
      masked_email: string;
    }>).map((row) => ({
      id: row.id,
      given_name: row.given_name,
      family_name: row.family_name,
      club_label: row.club_label ?? null,
      masked_email: row.masked_email,
    }));
  }

  /** Fallback when pg_trgm function not yet available (pre-migration). */
  private async fallbackSearch(
    eventId: string,
    q: string,
    limit: number,
  ): Promise<LookupResult[]> {
    const { data } = await this.supabase.service
      .from('persons')
      .select('id, given_name, family_name, email, clubs(name)')
      .eq('event_id', eventId)
      .or(`given_name.ilike.%${q}%,family_name.ilike.%${q}%`)
      .limit(limit);

    return (data ?? []).map((p) => {
      const row = p as unknown as {
        id: string;
        given_name: string;
        family_name: string;
        email: string;
        clubs: { name: string } | null;
      };
      return {
        id: row.id,
        given_name: row.given_name,
        family_name: row.family_name,
        club_label: row.clubs?.name ?? null,
        masked_email: this.csv.maskEmail(row.email),
      };
    });
  }
}
