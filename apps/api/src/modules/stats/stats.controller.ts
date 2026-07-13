/**
 * stats.controller.ts — T-1002
 *
 * GET /api/v1/tournaments/:id/stats/overview
 * GET /api/v1/tournaments/:id/stats/fighters
 *
 * Stats are computed on-read (fighter_exchange_stats, migration 0128) — there is
 * no manual refresh endpoint because there is no materialized view to refresh.
 */

import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { StatsService } from './stats.service';

@ApiTags('stats')
@Controller()
export class StatsController {
  constructor(private readonly stats: StatsService) {}

  @Get('tournaments/:id/stats/overview')
  @ApiOperation({ summary: 'Tournament stats overview (participants, matches, doubles%, clubs)' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  async overview(@Param('id', ParseUUIDPipe) id: string) {
    return this.stats.getTournamentOverview(id);
  }

  @Get('tournaments/:id/stats/fighters')
  @ApiOperation({ summary: 'Per-fighter exchange stats (lyonamhe.fr layout)' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  async fighters(@Param('id', ParseUUIDPipe) id: string) {
    return this.stats.getFighterStats(id);
  }
}
