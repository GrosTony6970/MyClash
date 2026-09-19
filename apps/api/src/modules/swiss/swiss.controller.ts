import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiQuery, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import {
  assertCanManagePhase,
  assertCanManageSwissRound,
  assertTournamentMember,
  type OrgRole,
} from '../../common/auth/event-authz';
import { assertCanManageTournament } from '../../common/auth/registration-authz';
import { requireRequestUserId } from '../../common/auth/request-user';
import { assertCanSetSwissSides, SWISS_WRITE_ROLE } from '../../common/auth/swiss-authz';
import { OrganizationsService } from '../organizations/organizations.service';
import { SupabaseService } from '../supabase/supabase.service';
import { SwissService } from './swiss.service';
import { SwissPairingService } from './swiss-pairing.service';
import { SwissOverrideService } from './swiss-override.service';
import { SwissFinaliseService } from './swiss-finalise.service';
import { SwissAdminViewService } from './swiss-admin-view.service';
import {
  GenerateSwissDto,
  SetSwissSidesDto,
  SwapPairingDto,
  UpdateSwissConfigDto,
  WithdrawSwissDto,
} from './dto/swiss.dto';

/**
 * Writes need `admin`, reads any member (`SWISS_WRITE_ROLE`, ruling 34). Each
 * route reads its Event from the row it names — tournament, phase, round or
 * match — never from the caller. The caller is resolved first: no token is a
 * 401 before any read. The id that reaches a service is the caller's, so the
 * audit log always names a person.
 */
@ApiTags('swiss')
@ApiBearerAuth()
@Controller()
export class SwissController {
  constructor(
    private readonly swiss: SwissService,
    private readonly pairing: SwissPairingService,
    private readonly override: SwissOverrideService,
    private readonly finaliser: SwissFinaliseService,
    private readonly adminView: SwissAdminViewService,
    private readonly supabase: SupabaseService,
    private readonly organizations: OrganizationsService,
  ) {}

  /** Deps in the shape `event-authz` takes. */
  private get authz() {
    return { supabase: this.supabase, orgs: this.organizations };
  }

  /** The caller, once they hold `minRole` on the phase's own Event. */
  private async callerOnPhase(
    req: FastifyRequest,
    phaseId: string,
    minRole: OrgRole = SWISS_WRITE_ROLE,
  ): Promise<string> {
    const userId = await requireRequestUserId(req, this.supabase);
    await assertCanManagePhase(this.authz, phaseId, userId, minRole);
    return userId;
  }

  @Get('tournaments/:tournamentId/swiss-admin')
  @ApiOperation({
    summary: 'The organiser view of a Swiss phase (org member)',
    description:
      'Config, entrant roster with names and withdrawals, and every round with its pairings and validity. Answers for a tournament with no Swiss phase too, so the Configure tab can propose a round count for the field.',
  })
  @ApiParam({ name: 'tournamentId', format: 'uuid' })
  async getAdminView(
    @Param('tournamentId', ParseUUIDPipe) tournamentId: string,
    @Req() req: FastifyRequest,
  ) {
    const userId = await requireRequestUserId(req, this.supabase);
    await assertTournamentMember(this.authz, tournamentId, userId);
    return this.adminView.getAdminView(tournamentId);
  }

  @Post('tournaments/:tournamentId/generate-swiss')
  @ApiOperation({
    summary: 'Generate a Swiss phase (org admin+)',
    description:
      'Creates the phase, freezes its field and pairs round 1. Coexists with a pool phase — pools → Swiss → bracket is a valid three-stage tournament.',
  })
  @ApiParam({ name: 'tournamentId', format: 'uuid' })
  @ApiQuery({ name: 'force', required: false, type: Boolean })
  async generate(
    @Param('tournamentId', ParseUUIDPipe) tournamentId: string,
    @Body() dto: GenerateSwissDto,
    @Req() req: FastifyRequest,
    @Query('force') force?: string,
  ) {
    const userId = await requireRequestUserId(req, this.supabase);
    await assertCanManageTournament(this.authz, tournamentId, userId, SWISS_WRITE_ROLE);
    return this.swiss.generateSwiss(tournamentId, dto, force === 'true', userId);
  }

  @Get('swiss-phases/:phaseId/next-round')
  @ApiOperation({
    summary: 'Preview the next round (org member)',
    description: 'Read-only. Shows the pairings, bye and warnings without writing anything.',
  })
  @ApiParam({ name: 'phaseId', format: 'uuid' })
  async previewNextRound(
    @Param('phaseId', ParseUUIDPipe) phaseId: string,
    @Req() req: FastifyRequest,
  ) {
    await this.callerOnPhase(req, phaseId, 'read_only');
    return (await this.pairing.planNextRound(phaseId)) ?? { roundNumber: null, plan: null };
  }

  @Post('swiss-phases/:phaseId/next-round')
  @ApiOperation({
    summary: 'Commit the next round (org admin+)',
    description:
      'Normally unnecessary — a round auto-pairs when the previous one completes. This is the manual door for a round that needs re-triggering.',
  })
  @ApiParam({ name: 'phaseId', format: 'uuid' })
  async commitNextRound(
    @Param('phaseId', ParseUUIDPipe) phaseId: string,
    @Req() req: FastifyRequest,
  ) {
    await this.callerOnPhase(req, phaseId);
    return (await this.pairing.commitNextRound(phaseId)) ?? { committed: false };
  }

  @Patch('swiss-phases/:phaseId/config')
  @ApiOperation({ summary: 'Update the Swiss configuration (org admin+)' })
  @ApiParam({ name: 'phaseId', format: 'uuid' })
  async updateConfig(
    @Param('phaseId', ParseUUIDPipe) phaseId: string,
    @Body() dto: UpdateSwissConfigDto,
    @Req() req: FastifyRequest,
  ) {
    const userId = await this.callerOnPhase(req, phaseId);
    return this.swiss.updateConfig(phaseId, dto, userId);
  }

  @Post('swiss-phases/:phaseId/withdraw')
  @ApiOperation({
    summary: 'Withdraw a fighter (org admin+)',
    description:
      'Excluded from later pairings; played results stand and still count toward opponents.',
  })
  @ApiParam({ name: 'phaseId', format: 'uuid' })
  async withdraw(
    @Param('phaseId', ParseUUIDPipe) phaseId: string,
    @Body() dto: WithdrawSwissDto,
    @Req() req: FastifyRequest,
  ) {
    const userId = await this.callerOnPhase(req, phaseId);
    return this.swiss.withdraw(phaseId, dto.registrationId, userId);
  }

  @Delete('swiss-phases/:phaseId/rounds/:roundNumber')
  @ApiOperation({
    summary: 'Delete the last round, only while nothing in it has started (org admin+)',
  })
  @ApiParam({ name: 'phaseId', format: 'uuid' })
  async deleteRound(
    @Param('phaseId', ParseUUIDPipe) phaseId: string,
    @Param('roundNumber', ParseIntPipe) roundNumber: number,
    @Req() req: FastifyRequest,
  ) {
    const userId = await this.callerOnPhase(req, phaseId);
    return this.swiss.deleteRound(phaseId, roundNumber, userId);
  }

  @Post('swiss-phases/:phaseId/finalise')
  @ApiOperation({ summary: 'Freeze the standings and resolve the podium (org admin+)' })
  @ApiParam({ name: 'phaseId', format: 'uuid' })
  async finalise(@Param('phaseId', ParseUUIDPipe) phaseId: string, @Req() req: FastifyRequest) {
    const userId = await this.callerOnPhase(req, phaseId);
    return this.finaliser.finalise(phaseId, userId);
  }

  @Post('swiss-phases/:phaseId/resume')
  @ApiOperation({
    summary: 'Resume a finalised phase (org admin+)',
    description: 'Refused once a bracket seeded from these standings has a bout under way.',
  })
  @ApiParam({ name: 'phaseId', format: 'uuid' })
  async resume(@Param('phaseId', ParseUUIDPipe) phaseId: string, @Req() req: FastifyRequest) {
    const userId = await this.callerOnPhase(req, phaseId);
    return this.finaliser.unfinalise(phaseId, userId);
  }

  @Post('swiss-rounds/:roundId/swap')
  @ApiOperation({
    summary: 'Swap two fighters (org admin+)',
    description:
      'The default override. Invariant-preserving: everyone still appears once and there is still one bye. Either fighter may be the bye holder. 409 with warnings unless confirm is set.',
  })
  @ApiParam({ name: 'roundId', format: 'uuid' })
  async swap(
    @Param('roundId', ParseUUIDPipe) roundId: string,
    @Body() dto: SwapPairingDto,
    @Req() req: FastifyRequest,
  ) {
    // Both fighters must already sit in the round (`swapPairing` finds them
    // there), so the ids need no check of their own.
    const userId = await requireRequestUserId(req, this.supabase);
    await assertCanManageSwissRound(this.authz, roundId, userId, SWISS_WRITE_ROLE);
    return this.override.swapPairing(
      roundId,
      dto.aRegistrationId,
      dto.bRegistrationId,
      userId,
      dto.confirm ?? false,
    );
  }

  @Patch('matches/:matchId/swiss-sides')
  @ApiOperation({
    summary: 'Set both sides of a Swiss match (org admin+)',
    description:
      "The escape hatch. Can leave the round invalid; the response carries the validation, and an invalid round blocks the next one. Each fighter must be entered in the match's tournament.",
  })
  @ApiParam({ name: 'matchId', format: 'uuid' })
  async setSides(
    @Param('matchId', ParseUUIDPipe) matchId: string,
    @Body() dto: SetSwissSidesDto,
    @Req() req: FastifyRequest,
  ) {
    const userId = await requireRequestUserId(req, this.supabase);
    await assertCanSetSwissSides(
      this.authz,
      matchId,
      [dto.redRegistrationId, dto.blueRegistrationId],
      userId,
    );
    return this.override.setMatchSides(
      matchId,
      dto.redRegistrationId,
      dto.blueRegistrationId,
      userId,
      dto.confirm ?? false,
    );
  }
}
