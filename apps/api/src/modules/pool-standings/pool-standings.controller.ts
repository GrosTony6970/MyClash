import {
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Query,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiQuery, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { canReadTournament, publicReader } from '../../common/auth/competition-visibility';
import { Public } from '../../common/auth/public.decorator';
import { OrganizationsService } from '../organizations/organizations.service';
import { SupabaseService } from '../supabase/supabase.service';
import { PoolStandingsService } from './pool-standings.service';

@ApiTags('pool-standings')
@ApiBearerAuth()
// Anonymous by evidence, not by assumption: the PUBLIC tournament page fetches
// this client-side with no credentials —
// apps/web-public/app/e/[eventSlug]/t/[tournamentSlug]/FinalRankingTab.tsx:72.
// The class-level @ApiBearerAuth() here is Swagger decoration and enforces
// nothing; the data is the same public standings already served by
// events.controller's unauthenticated standings route.
@Public()
@Controller()
export class PoolStandingsController {
  constructor(
    private readonly service: PoolStandingsService,
    private readonly supabase: SupabaseService,
    private readonly orgs: OrganizationsService,
  ) {}

  /**
   * GET /api/v1/tournaments/:tournamentId/pool-standings?mode=by-pool|overall
   *
   * A Tournament hidden from the caller answers as an unknown one, in the
   * service's own words (rulings 81-83). Gated here, not in the service: seeding
   * and placements call the service for Tournaments nobody is reading.
   */
  @Get('tournaments/:tournamentId/pool-standings')
  @ApiOperation({ summary: 'Compute pool standings for a tournament' })
  @ApiParam({ name: 'tournamentId', type: 'string', format: 'uuid' })
  @ApiQuery({ name: 'mode', enum: ['by-pool', 'overall'], required: false })
  async get(
    @Param('tournamentId', ParseUUIDPipe) tournamentId: string,
    @Query('mode') modeRaw: string | undefined,
    @Req() req: FastifyRequest,
  ) {
    const deps = { supabase: this.supabase, orgs: this.orgs };
    if (!(await canReadTournament(deps, tournamentId, publicReader(req)))) {
      throw new NotFoundException(`Tournament ${tournamentId} not found`);
    }
    const mode = modeRaw === 'by-pool' ? 'by-pool' : 'overall';
    return this.service.getPoolStandings(tournamentId, mode);
  }
}
