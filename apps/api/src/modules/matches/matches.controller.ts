import { Public } from '../../common/auth/public.decorator';
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { StaffService } from '../staff/staff.service';
import { ClockService } from './clock.service';
import { MatchForfeitsService } from './match-forfeits.service';
import { MatchesService } from './matches.service';
import {
  AdjustClockDto,
  CreateExchangeDto,
  CreateMatchForfeitDto,
  CreateMatchDto,
  EditExchangeDto,
  ResetMatchDto,
  UpdateMatchDto,
  UpdateMatchStatusDto,
  VoidExchangeDto,
} from './dto/matches.dto';

const clockActionSchema = z
  .object({
    action: z.enum(['start', 'halt', 'resume', 'end', 'reopen', 'reset_clock']),
    reason: z.string().optional(),
  })
  .strict();
class ClockActionDto extends createZodDto(clockActionSchema) {}

const refereeRoleAssignmentSchema = z
  .object({
    role: z.string(),
    // Null clears the assignment for this (match, role) pair.
    refereeId: z.uuid().nullable(),
  })
  .strict();
class RefereeRoleAssignmentDto extends createZodDto(refereeRoleAssignmentSchema) {}

@ApiTags('matches')
@ApiBearerAuth()
@Controller()
export class MatchesController {
  constructor(
    private readonly matches: MatchesService,
    private readonly forfeits: MatchForfeitsService,
    private readonly clock: ClockService,
    private readonly staff: StaffService,
  ) {}

  // ── Matches ──────────────────────────────────────────────────────────────────

  @Get('phases/:phaseId/matches')
  @ApiOperation({ summary: 'List matches for a phase (public)' })
  @ApiParam({ name: 'phaseId', type: 'string', format: 'uuid' })
  async listByPhase(@Param('phaseId', ParseUUIDPipe) phaseId: string) {
    return this.matches.listByPhase(phaseId);
  }

  @Public()
  @Get('matches/:id')
  @ApiOperation({ summary: 'Get match by ID (public)' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  async getMatch(@Param('id', ParseUUIDPipe) id: string) {
    return this.matches.getMatch(id);
  }

  @Public()
  @Get('matches/:id/summary')
  @ApiOperation({ summary: 'Match header summary for the scoreboard page (public)' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  async getMatchSummary(@Param('id', ParseUUIDPipe) id: string) {
    return this.matches.getMatchSummary(id);
  }

  @Post('phases/:phaseId/matches')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a match (org admin+)' })
  @ApiParam({ name: 'phaseId', type: 'string', format: 'uuid' })
  async createMatch(@Body() dto: CreateMatchDto) {
    return this.matches.createMatch(dto);
  }

  @Patch('matches/:id/status')
  @ApiOperation({ summary: 'Update match status (scorekeeper+)' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  async updateStatus(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateMatchStatusDto) {
    return this.matches.updateStatus(id, dto);
  }

  @Patch('matches/:id/schedule')
  @ApiOperation({ summary: 'Update match scheduled_at and lice_id (organizer+)' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  async scheduleMatch(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: { liceId?: string | null; scheduledAt?: string | null },
  ) {
    return this.matches.scheduleMatch(id, dto.liceId ?? null, dto.scheduledAt ?? null);
  }

  @Delete('pools/:poolId/schedule')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary:
      'Clear every match of a pool that is scheduled on the given day (?day=YYYY-MM-DD). Powers the "Clear pool" handle on the schedule grid.',
  })
  @ApiParam({ name: 'poolId', type: 'string', format: 'uuid' })
  async clearPoolScheduleForDay(
    @Param('poolId', ParseUUIDPipe) poolId: string,
    @Query('day') day: string,
  ) {
    if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) {
      throw new BadRequestException('day query parameter required (YYYY-MM-DD)');
    }
    await this.matches.clearPoolScheduleForDay(poolId, day);
  }

  @Patch('matches/:id')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update lice and/or referee assignment for a match' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  async update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateMatchDto) {
    return this.matches.update(id, dto);
  }

  @Put('matches/:id/referee-role-assignments')
  @ApiOperation({
    summary:
      'Set (or clear) the referee for one (match, role) pair in referee_assignments (scope_type=match)',
  })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  async setRefereeRoleAssignment(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RefereeRoleAssignmentDto,
  ) {
    return this.matches.setRefereeRoleAssignment(id, dto.role, dto.refereeId);
  }

  @Post('matches/:id/void')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Void a match (organizer+)' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  async voidMatch(@Param('id', ParseUUIDPipe) id: string) {
    return this.matches.voidMatch(id);
  }

  @Post('matches/:id/forfeit')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Record a match forfeit (scorekeeper+)' })
  async createForfeit(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateMatchForfeitDto,
    @Req() req: FastifyRequest,
  ) {
    const actor = await this.staff.authorizeMatchScoring(req, id);
    return this.forfeits.createForfeit(id, dto, actor);
  }

  @Patch('match-forfeits/:id/void')
  @ApiOperation({ summary: 'Void a match forfeit when downstream state allows it' })
  async voidForfeit(@Param('id', ParseUUIDPipe) id: string, @Req() req: FastifyRequest) {
    const actor = await this.staff.authorizeForfeitOrganizer(req, id);
    return this.forfeits.voidForfeit(id, actor);
  }

  // (`POST matches/:id/lock` was removed — no UI called it; locking happens
  // via the auto-lock service, which calls MatchesService.lockMatch directly.)

  @Post('matches/:id/unlock')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Unlock match scoring (organizer; or staff when auto-lock disabled)' })
  async unlockMatch(@Param('id', ParseUUIDPipe) id: string, @Req() req: FastifyRequest) {
    // Organiser may always reopen; event staff may reopen when auto-lock is disabled.
    const actor = await this.staff.authorizeMatchUnlock(req, id);
    return this.matches.unlockMatch(id, actor);
  }

  // ── Exchanges ─────────────────────────────────────────────────────────────────

  @Public()
  @Get('matches/:id/exchanges')
  @ApiOperation({ summary: 'List exchanges for a match (public)' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  async listExchanges(@Param('id', ParseUUIDPipe) id: string) {
    return this.matches.listExchanges(id);
  }

  /**
   * POST /api/v1/matches/:id/exchanges
   * Idempotent on client_uuid — safe to call multiple times from offline queue.
   */
  @Post('matches/:id/exchanges')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Record an exchange (scorekeeper+, idempotent on client_uuid)' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  async createExchange(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateExchangeDto,
    @Req() req: FastifyRequest,
  ) {
    const actor = await this.staff.authorizeMatchScoring(req, id);
    return this.matches.createExchange(id, dto, actor);
  }

  /**
   * POST /api/v1/matches/:id/rounds/advance
   * Start the next round of a best-of-N match (scorekeeper+). Resets the clock.
   */
  @Post('matches/:id/rounds/advance')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Advance to the next round in a best-of-N match (scorekeeper+)' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  async advanceRound(@Param('id', ParseUUIDPipe) id: string, @Req() req: FastifyRequest) {
    const actor = await this.staff.authorizeMatchScoring(req, id);
    return this.matches.advanceRound(id, actor);
  }

  /**
   * POST /api/v1/matches/:id/rounds/end
   * End the current round on time in a best-of-N match (scorekeeper+). The round
   * winner is whoever leads; a tied round is rejected (play a sudden-death point).
   */
  @Post('matches/:id/rounds/end')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'End the current round on time in a best-of-N match (scorekeeper+)' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  async endRound(@Param('id', ParseUUIDPipe) id: string, @Req() req: FastifyRequest) {
    const actor = await this.staff.authorizeMatchScoring(req, id);
    return this.matches.endRoundOnTime(id, actor);
  }

  /**
   * PATCH /api/v1/exchanges/:id/void
   * Sets voided=true. Never deletes the row.
   */
  @Patch('exchanges/:id/void')
  @ApiOperation({ summary: 'Void an exchange (organizer+). Never deletes.' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  async voidExchange(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: VoidExchangeDto,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const actor = await this.staff.authorizeExchangeScoring(req, id);
    const result = await this.matches.voidExchange(id, dto, actor);
    if ((result as { pendingReview?: boolean }).pendingReview) reply.status(HttpStatus.ACCEPTED);
    return result;
  }

  /**
   * PATCH /api/v1/exchanges/:id/revert-void
   * Restores a voided exchange (sets voided=false). Recomputes score.
   */
  @Patch('exchanges/:id/revert-void')
  @ApiOperation({
    summary: 'Revert a voided exchange (organizer+). Restores and recomputes score.',
  })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  async revertVoidExchange(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const actor = await this.staff.authorizeExchangeScoring(req, id);
    const result = await this.matches.revertVoidExchange(id, actor);
    if ((result as { pendingReview?: boolean }).pendingReview) reply.status(HttpStatus.ACCEPTED);
    return result;
  }

  // (`POST matches/:id/exchanges/clear-last` was removed — the scoring pad's
  // clear-last button voids the specific latest row via `exchanges/:id/void`.)

  @Patch('exchanges/:id/edit')
  @ApiOperation({ summary: 'Edit an exchange by voiding and replacing it (scorekeeper+)' })
  async editExchange(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: EditExchangeDto,
    @Req() req: FastifyRequest,
  ) {
    const actor = await this.staff.authorizeExchangeScoring(req, id);
    return this.matches.editExchange(id, dto, actor);
  }

  @Post('matches/:id/swap-fighter-color')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Swap red/blue fighter scoring colors (scorekeeper+)' })
  async swapFighterColor(@Param('id', ParseUUIDPipe) id: string, @Req() req: FastifyRequest) {
    const actor = await this.staff.authorizeMatchScoring(req, id);
    return this.matches.swapFighterColor(id, actor);
  }

  @Post('matches/:id/swap-fighter-side')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Swap left/right fighter display sides (scorekeeper+)' })
  async swapFighterSide(@Param('id', ParseUUIDPipe) id: string, @Req() req: FastifyRequest) {
    const actor = await this.staff.authorizeMatchScoring(req, id);
    return this.matches.swapFighterSide(id, actor);
  }

  @Post('matches/:id/reset')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reset match state after typed confirmation (scorekeeper+)' })
  async resetMatch(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ResetMatchDto,
    @Req() req: FastifyRequest,
  ) {
    const actor = await this.staff.authorizeMatchScoring(req, id);
    return this.matches.resetMatch(id, dto, actor);
  }

  // ── Clock endpoints ───────────────────────────────────────────────────────

  /**
   * GET /api/v1/matches/:id/clock
   * Returns current clock state computed from match_events timeline.
   * Reload-safe: always recomputes from server state.
   */
  @Get('matches/:id/clock')
  @ApiOperation({ summary: 'Get clock state (computed from match_events timeline)' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  async getClockState(@Param('id', ParseUUIDPipe) id: string) {
    return this.clock.getClockState(id);
  }

  /**
   * POST /api/v1/matches/:id/clock
   * Perform a clock action: start | halt | resume | end | reopen | reset_clock.
   * Persists a match_events row and updates match.status. `reopen` reverses
   * a prior `end`, returning the clock to halted with accumulated active
   * time preserved.
   */
  @Post('matches/:id/clock')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Clock action: start | halt | resume | end | reopen | reset_clock' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  async clockAction(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ClockActionDto,
    @Req() req: FastifyRequest,
  ) {
    const actor = await this.staff.authorizeMatchScoring(req, id);
    return this.clock.clockAction(id, dto.action, dto.reason, actor);
  }

  @Post('matches/:id/clock/adjust')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Adjust match clock by signed milliseconds (scorekeeper+)' })
  async adjustClock(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AdjustClockDto,
    @Req() req: FastifyRequest,
  ) {
    const actor = await this.staff.authorizeMatchScoring(req, id);
    return this.clock.adjustTime(id, dto.adjustmentMs, dto.reason, actor);
  }
}
