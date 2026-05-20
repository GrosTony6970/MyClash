import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiQuery, ApiTags } from '@nestjs/swagger';
import { PoolStandingsService } from './pool-standings.service';

@ApiTags('pool-standings')
@ApiBearerAuth()
@Controller()
export class PoolStandingsController {
  constructor(private readonly service: PoolStandingsService) {}

  /** GET /api/v1/tournaments/:tournamentId/pool-standings?mode=by-pool|overall */
  @Get('tournaments/:tournamentId/pool-standings')
  @ApiOperation({ summary: 'Compute pool standings for a tournament' })
  @ApiParam({ name: 'tournamentId', type: 'string', format: 'uuid' })
  @ApiQuery({ name: 'mode', enum: ['by-pool', 'overall'], required: false })
  async get(
    @Param('tournamentId', ParseUUIDPipe) tournamentId: string,
    @Query('mode') modeRaw?: string,
  ) {
    const mode = modeRaw === 'by-pool' ? 'by-pool' : 'overall';
    return this.service.getPoolStandings(tournamentId, mode);
  }
}
