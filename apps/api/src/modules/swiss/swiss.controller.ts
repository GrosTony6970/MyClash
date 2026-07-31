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
import { SupabaseService } from '../supabase/supabase.service';
import { SwissService } from './swiss.service';
import { SwissPairingService } from './swiss-pairing.service';
import { SwissOverrideService } from './swiss-override.service';
import { SwissFinaliseService } from './swiss-finalise.service';
import {
  GenerateSwissDto,
  SetSwissSidesDto,
  SwapPairingDto,
  UpdateSwissConfigDto,
  WithdrawSwissDto,
} from './dto/swiss.dto';

/**
 * Resolve the acting user for the audit trail.
 *
 * Returns null, never a sentinel string: `audit_log.actor_user_id` is a UUID
 * column and 'unknown'/'system' would either fail the insert or, worse, land as
 * an unqueryable actor. NULL is the documented value for "no human actor".
 */
async function actorUserId(req: FastifyRequest, supabase: SupabaseService): Promise<string | null> {
  const authHeader = req.headers['authorization'];
  const cookies = (req as FastifyRequest & { cookies?: Record<string, string> }).cookies;
  const token = authHeader?.startsWith('Bearer ')
    ? authHeader.slice(7)
    : cookies?.['sb-access-token'];
  if (!token) return null;
  const {
    data: { user },
  } = await supabase.anon.auth.getUser(token);
  return user?.id ?? null;
}

@ApiTags('swiss')
@ApiBearerAuth()
@Controller()
export class SwissController {
  constructor(
    private readonly swiss: SwissService,
    private readonly pairing: SwissPairingService,
    private readonly override: SwissOverrideService,
    private readonly finaliser: SwissFinaliseService,
    private readonly supabase: SupabaseService,
  ) {}

  @Post('tournaments/:tournamentId/generate-swiss')
  @ApiOperation({
    summary: 'Generate a Swiss phase',
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
    return this.swiss.generateSwiss(
      tournamentId,
      dto,
      force === 'true',
      await actorUserId(req, this.supabase),
    );
  }

  @Get('swiss-phases/:phaseId/next-round')
  @ApiOperation({
    summary: 'Preview the next round',
    description: 'Read-only. Shows the pairings, bye and warnings without writing anything.',
  })
  @ApiParam({ name: 'phaseId', format: 'uuid' })
  async previewNextRound(@Param('phaseId', ParseUUIDPipe) phaseId: string) {
    return (await this.pairing.planNextRound(phaseId)) ?? { roundNumber: null, plan: null };
  }

  @Post('swiss-phases/:phaseId/next-round')
  @ApiOperation({
    summary: 'Commit the next round',
    description:
      'Normally unnecessary — a round auto-pairs when the previous one completes. This is the manual door for a round that needs re-triggering.',
  })
  @ApiParam({ name: 'phaseId', format: 'uuid' })
  async commitNextRound(@Param('phaseId', ParseUUIDPipe) phaseId: string) {
    return (await this.pairing.commitNextRound(phaseId)) ?? { committed: false };
  }

  @Patch('swiss-phases/:phaseId/config')
  @ApiOperation({ summary: 'Update the Swiss configuration' })
  @ApiParam({ name: 'phaseId', format: 'uuid' })
  async updateConfig(
    @Param('phaseId', ParseUUIDPipe) phaseId: string,
    @Body() dto: UpdateSwissConfigDto,
    @Req() req: FastifyRequest,
  ) {
    return this.swiss.updateConfig(phaseId, dto, await actorUserId(req, this.supabase));
  }

  @Post('swiss-phases/:phaseId/withdraw')
  @ApiOperation({
    summary: 'Withdraw a fighter',
    description:
      'Excluded from later pairings; played results stand and still count toward opponents.',
  })
  @ApiParam({ name: 'phaseId', format: 'uuid' })
  async withdraw(
    @Param('phaseId', ParseUUIDPipe) phaseId: string,
    @Body() dto: WithdrawSwissDto,
    @Req() req: FastifyRequest,
  ) {
    return this.swiss.withdraw(phaseId, dto.registrationId, await actorUserId(req, this.supabase));
  }

  @Delete('swiss-phases/:phaseId/rounds/:roundNumber')
  @ApiOperation({ summary: 'Delete the last round (only while nothing in it has started)' })
  @ApiParam({ name: 'phaseId', format: 'uuid' })
  async deleteRound(
    @Param('phaseId', ParseUUIDPipe) phaseId: string,
    @Param('roundNumber', ParseIntPipe) roundNumber: number,
    @Req() req: FastifyRequest,
  ) {
    return this.swiss.deleteRound(phaseId, roundNumber, await actorUserId(req, this.supabase));
  }

  @Post('swiss-phases/:phaseId/finalise')
  @ApiOperation({ summary: 'Freeze the standings and resolve the podium' })
  @ApiParam({ name: 'phaseId', format: 'uuid' })
  async finalise(@Param('phaseId', ParseUUIDPipe) phaseId: string, @Req() req: FastifyRequest) {
    return this.finaliser.finalise(phaseId, await actorUserId(req, this.supabase));
  }

  @Post('swiss-phases/:phaseId/resume')
  @ApiOperation({
    summary: 'Resume a finalised phase',
    description: 'Refused once a bracket seeded from these standings has a bout under way.',
  })
  @ApiParam({ name: 'phaseId', format: 'uuid' })
  async resume(@Param('phaseId', ParseUUIDPipe) phaseId: string, @Req() req: FastifyRequest) {
    return this.finaliser.unfinalise(phaseId, await actorUserId(req, this.supabase));
  }

  @Post('swiss-rounds/:roundId/swap')
  @ApiOperation({
    summary: 'Swap two fighters',
    description:
      'The default override. Invariant-preserving: everyone still appears once and there is still one bye. Either fighter may be the bye holder. 409 with warnings unless confirm is set.',
  })
  @ApiParam({ name: 'roundId', format: 'uuid' })
  async swap(
    @Param('roundId', ParseUUIDPipe) roundId: string,
    @Body() dto: SwapPairingDto,
    @Req() req: FastifyRequest,
  ) {
    return this.override.swapPairing(
      roundId,
      dto.aRegistrationId,
      dto.bRegistrationId,
      await actorUserId(req, this.supabase),
      dto.confirm ?? false,
    );
  }

  @Patch('matches/:matchId/swiss-sides')
  @ApiOperation({
    summary: 'Set both sides of a Swiss match',
    description:
      'The escape hatch. Can leave the round invalid; the response carries the validation, and an invalid round blocks the next one.',
  })
  @ApiParam({ name: 'matchId', format: 'uuid' })
  async setSides(
    @Param('matchId', ParseUUIDPipe) matchId: string,
    @Body() dto: SetSwissSidesDto,
    @Req() req: FastifyRequest,
  ) {
    return this.override.setMatchSides(
      matchId,
      dto.redRegistrationId,
      dto.blueRegistrationId,
      await actorUserId(req, this.supabase),
      dto.confirm ?? false,
    );
  }
}
