/**
 * stats.controller.ts — T-1002
 *
 * GET /api/v1/tournaments/:id/stats/overview
 * GET /api/v1/tournaments/:id/stats/fighters
 *
 * Stats are computed on-read (fighter_exchange_stats, migration 0128) — there is
 * no manual refresh endpoint because there is no materialized view to refresh.
 */

import { Controller, Get, Param, ParseUUIDPipe, Req } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { canReadTournament, publicReader } from '../../common/auth/competition-visibility';
import { Public } from '../../common/auth/public.decorator';
import { OrganizationsService } from '../organizations/organizations.service';
import { SupabaseService } from '../supabase/supabase.service';
import {
  StatsService,
  type FighterStatsResponse,
  type TournamentStatsOverview,
} from './stats.service';
import { aggregateTargetValues } from './target-value-stats';

/**
 * What the service answers an unknown Tournament, which is what a hidden one
 * must look like (rulings 81-83). `tournament-public-reads.test.ts` runs the
 * real service on an unknown id and holds these to its answers.
 */
const noOverview = (tournamentId: string): TournamentStatsOverview => ({
  tournamentId,
  participantCount: 0,
  matchCount: 0,
  exchangeCount: 0,
  doublesCount: 0,
  doublesPercent: 0,
  clubCount: 0,
  topFighters: [],
});
const NO_FIGHTER_STATS: FighterStatsResponse = {
  fighters: [],
  afterblow: { valuation: null, fixedValue: null },
};

@ApiTags('stats')
// Three GET reads, all rendered on the public tournament stats page (SSR, no
// credentials) — t/[tournamentSlug]/stats/page.tsx:94,97,100. A Tournament
// hidden from the caller answers as an unknown one. Gated here, not in the
// service: the organiser's event statistics call it too.
@Public()
@Controller()
export class StatsController {
  constructor(
    private readonly stats: StatsService,
    private readonly supabase: SupabaseService,
    private readonly orgs: OrganizationsService,
  ) {}

  @Get('tournaments/:id/stats/overview')
  @ApiOperation({ summary: 'Tournament stats overview (participants, matches, doubles%, clubs)' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  async overview(@Param('id', ParseUUIDPipe) id: string, @Req() req: FastifyRequest) {
    if (!(await this.canRead(id, req))) return noOverview(id);
    return this.stats.getTournamentOverview(id);
  }

  @Get('tournaments/:id/stats/fighters')
  @ApiOperation({ summary: 'Per-fighter exchange stats (lyonamhe.fr layout)' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  async fighters(@Param('id', ParseUUIDPipe) id: string, @Req() req: FastifyRequest) {
    if (!(await this.canRead(id, req))) return NO_FIGHTER_STATS;
    return this.stats.getFighterStats(id);
  }

  @Get('tournaments/:id/stats/target-values')
  @ApiOperation({
    summary: 'Exchange point-value distribution + deep-target hunters (clean hits, ruleset-aware)',
  })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  async targetValues(@Param('id', ParseUUIDPipe) id: string, @Req() req: FastifyRequest) {
    if (!(await this.canRead(id, req))) return aggregateTargetValues([]);
    return this.stats.getTargetValueStats(id);
  }

  private canRead(tournamentId: string, req: FastifyRequest): Promise<boolean> {
    const deps = { supabase: this.supabase, orgs: this.orgs };
    return canReadTournament(deps, tournamentId, publicReader(req));
  }
}
