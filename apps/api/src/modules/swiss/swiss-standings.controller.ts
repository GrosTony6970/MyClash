import { Controller, Get, NotFoundException, Param, ParseUUIDPipe, Req } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { canReadTournament, publicReader } from '../../common/auth/competition-visibility';
import { Public } from '../../common/auth/public.decorator';
import { DEFAULT_SIDE_COLORS } from '../events/side-colors';
import { OrganizationsService } from '../organizations/organizations.service';
import { SupabaseService } from '../supabase/supabase.service';
import { SwissStandingsService } from './swiss-standings.service';
import { noSwissRounds, SwissPublicRoundsService } from './swiss-public-rounds.service';

/**
 * Public Swiss reads.
 *
 * `@Public()` for the same reason the pool standings are: a spectator scanning
 * the QR code on the wall has no account, and these are the same results
 * already printed and announced. A Tournament hidden from the caller (a draft
 * Event, or a Tournament not published, running or completed) answers as an
 * unknown id does (rulings 81-83). Gated here, not in the services: pairing,
 * seeding and placements call them for Tournaments nobody is reading.
 */
@Public()
@ApiTags('swiss')
@Controller()
export class SwissStandingsController {
  constructor(
    private readonly standings: SwissStandingsService,
    private readonly rounds: SwissPublicRoundsService,
    private readonly supabase: SupabaseService,
    private readonly orgs: OrganizationsService,
  ) {}

  /** GET /api/v1/tournaments/:tournamentId/swiss-standings */
  @Get('tournaments/:tournamentId/swiss-standings')
  @ApiOperation({
    summary: 'Swiss standings',
    description:
      'Ranked on Swiss points or the ruleset score per the phase config, then the organiser-configured tiebreak chain.',
  })
  @ApiParam({ name: 'tournamentId', format: 'uuid' })
  async getStandings(
    @Param('tournamentId', ParseUUIDPipe) tournamentId: string,
    @Req() req: FastifyRequest,
  ) {
    if (!(await this.canRead(tournamentId, req))) {
      // The service's own words for an unknown id (resolveTournamentRuleset).
      throw new NotFoundException(`Tournament ${tournamentId} not found`);
    }
    return this.standings.getSwissStandings(tournamentId);
  }

  /** GET /api/v1/tournaments/:tournamentId/swiss */
  @Get('tournaments/:tournamentId/swiss')
  @ApiOperation({
    summary: 'Swiss rounds and pairings',
    description:
      'Every round with its bouts, bye and pairing metadata — including forced rematches and manual adjustments, which are badged publicly.',
  })
  @ApiParam({ name: 'tournamentId', format: 'uuid' })
  async getRounds(
    @Param('tournamentId', ParseUUIDPipe) tournamentId: string,
    @Req() req: FastifyRequest,
  ) {
    if (!(await this.canRead(tournamentId, req))) return noSwissRounds(DEFAULT_SIDE_COLORS);
    return this.rounds.getRounds(tournamentId);
  }

  private canRead(tournamentId: string, req: FastifyRequest): Promise<boolean> {
    const deps = { supabase: this.supabase, orgs: this.orgs };
    return canReadTournament(deps, tournamentId, publicReader(req));
  }
}
