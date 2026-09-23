import { Controller, Get, Param, ParseUUIDPipe, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { assertTournamentMember } from '../../common/auth/event-authz';
import { requireRequestUserId } from '../../common/auth/request-user';
import { PhasesService } from './phases.service';
import { SupabaseService } from '../supabase/supabase.service';
import { OrganizationsService } from '../organizations/organizations.service';

/**
 * The organiser's reads of a Tournament's Pools, bouts, scores, unplaced
 * fighters and bracket. They carry the whole roster and every bout's referee
 * crew, draft Events included, so they are for any member of the Tournament's
 * own club (operator ruling 79). Spectators read the public slug routes; the
 * pad and the staff desk read their staff-cookie routes.
 *
 * The caller is resolved first: no token is a 401 before any read.
 */
@ApiTags('phases')
@ApiBearerAuth()
@Controller()
export class PhaseReadsController {
  constructor(
    private readonly phases: PhasesService,
    private readonly supabase: SupabaseService,
    private readonly organizations: OrganizationsService,
  ) {}

  /** Refuses anyone but a member of the Tournament's own club. */
  private async assertMember(req: FastifyRequest, tournamentId: string): Promise<void> {
    const userId = await requireRequestUserId(req, this.supabase);
    await assertTournamentMember(
      { supabase: this.supabase, orgs: this.organizations },
      tournamentId,
      userId,
    );
  }

  @Get('tournaments/:tournamentId/pools')
  @ApiOperation({ summary: 'List generated pools for a tournament (org member)' })
  @ApiParam({ name: 'tournamentId', type: 'string', format: 'uuid' })
  async listPools(
    @Param('tournamentId', ParseUUIDPipe) tournamentId: string,
    @Req() req: FastifyRequest,
  ) {
    await this.assertMember(req, tournamentId);
    return this.phases.listTournamentPools(tournamentId);
  }

  /** GET /api/v1/tournaments/:tournamentId/pools-with-matches */
  @Get('tournaments/:tournamentId/pools-with-matches')
  @ApiOperation({
    summary: 'List pools with enriched match rows for the Matches tab (org member)',
  })
  @ApiParam({ name: 'tournamentId', type: 'string', format: 'uuid' })
  async listPoolsWithMatches(
    @Param('tournamentId', ParseUUIDPipe) tournamentId: string,
    @Req() req: FastifyRequest,
  ) {
    await this.assertMember(req, tournamentId);
    return this.phases.listPoolsWithMatches(tournamentId);
  }

  /**
   * Lightweight score snapshot for the pools Matches tab's 30s fallback
   * poll. Returns only `(id, status, red_score, blue_score)` so the FE
   * can merge changes in place without re-rendering the whole table.
   *
   * GET /api/v1/tournaments/:tournamentId/match-scores
   */
  @Get('tournaments/:tournamentId/match-scores')
  @ApiOperation({
    summary: 'Per-tournament match scores (lightweight, for surgical FE polling) (org member)',
  })
  @ApiParam({ name: 'tournamentId', type: 'string', format: 'uuid' })
  async listMatchScores(
    @Param('tournamentId', ParseUUIDPipe) tournamentId: string,
    @Req() req: FastifyRequest,
  ) {
    await this.assertMember(req, tournamentId);
    return this.phases.listMatchScores(tournamentId);
  }

  /** GET /api/v1/tournaments/:tournamentId/unassigned-fighters */
  @Get('tournaments/:tournamentId/unassigned-fighters')
  @ApiOperation({
    summary: 'List tournament registrations not yet assigned to any pool (org member)',
  })
  @ApiParam({ name: 'tournamentId', type: 'string', format: 'uuid' })
  async listUnassignedFighters(
    @Param('tournamentId', ParseUUIDPipe) tournamentId: string,
    @Req() req: FastifyRequest,
  ) {
    await this.assertMember(req, tournamentId);
    return this.phases.listUnassignedFighters(tournamentId);
  }

  @Get('tournaments/:tournamentId/bracket')
  @ApiOperation({ summary: 'Get generated bracket for a tournament (org member)' })
  @ApiParam({ name: 'tournamentId', type: 'string', format: 'uuid' })
  async getBracket(
    @Param('tournamentId', ParseUUIDPipe) tournamentId: string,
    @Req() req: FastifyRequest,
  ) {
    await this.assertMember(req, tournamentId);
    return this.phases.getTournamentBracket(tournamentId);
  }
}
