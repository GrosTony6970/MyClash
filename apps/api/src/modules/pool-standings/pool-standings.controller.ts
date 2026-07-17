import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/auth/public.decorator';
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
