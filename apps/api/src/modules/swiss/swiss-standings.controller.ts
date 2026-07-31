import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/auth/public.decorator';
import { SwissStandingsService } from './swiss-standings.service';
import { SwissPublicRoundsService } from './swiss-public-rounds.service';

/**
 * Public Swiss reads.
 *
 * `@Public()` for the same reason the pool standings are: a spectator scanning
 * the QR code on the wall has no account, and these are the same results
 * already printed and announced. Nothing here exposes anything a published
 * event does not already show.
 */
@Public()
@ApiTags('swiss')
@Controller()
export class SwissStandingsController {
  constructor(
    private readonly standings: SwissStandingsService,
    private readonly rounds: SwissPublicRoundsService,
  ) {}

  /** GET /api/v1/tournaments/:tournamentId/swiss-standings */
  @Get('tournaments/:tournamentId/swiss-standings')
  @ApiOperation({
    summary: 'Swiss standings',
    description:
      'Ranked on Swiss points or the ruleset score per the phase config, then the organiser-configured tiebreak chain.',
  })
  @ApiParam({ name: 'tournamentId', format: 'uuid' })
  async getStandings(@Param('tournamentId', ParseUUIDPipe) tournamentId: string) {
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
  async getRounds(@Param('tournamentId', ParseUUIDPipe) tournamentId: string) {
    return this.rounds.getRounds(tournamentId);
  }
}
