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
import { Throttle } from '@nestjs/throttler';
import { isOverrideReason } from '@myclash/rulesets';
import { PUBLIC_LIVE_READ_THROTTLE } from '../../common/throttling/throttle-profiles';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { StaffService } from '../staff/staff.service';
import { ClockService } from './clock.service';
import { MatchAuditService } from './match-audit.service';
import { MatchCompletionService } from '../phases/match-completion.service';
import { MatchForfeitsService } from './match-forfeits.service';
import { MatchesService } from './matches.service';
import { SupabaseService } from '../supabase/supabase.service';
// Value import, not `import type` — `import type` erases the DI metadata.
import { OrganizationsService } from '../organizations/organizations.service';
import { assertCanManagePool } from '../../common/auth/event-authz';
import { resolveRequestUserId } from '../../common/auth/request-user';
import {
  AdjustClockDto,
  CreateExchangeDto,
  CreateMatchForfeitDto,
  CreateMatchDto,
  EditExchangeDto,
  ResetMatchDto,
  ScheduleMatchDto,
  UpdateMatchDto,
  UpdateMatchStatusDto,
  VoidExchangeDto,
} from './dto/matches.dto';

const clockActionSchema = z
  .object({
    action: z.enum(['start', 'halt', 'resume', 'end', 'reopen', 'reset_clock']),
    reason: z.string().optional(),
    /** See `ResetMatchDto` — four of these actions can un-complete a bout. */
    discardDependentResults: z.boolean().optional(),
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
    private readonly matchAudit: MatchAuditService,
    // Value import, not `import type` — see di-wiring.regression.test.ts.
    private readonly matchCompletion: MatchCompletionService,
    private readonly supabase: SupabaseService,
    private readonly orgs: OrganizationsService,
  ) {}

  // ── Matches ──────────────────────────────────────────────────────────────────

  @Get('phases/:phaseId/matches')
  @ApiOperation({ summary: 'List matches for a phase (public)' })
  @ApiParam({ name: 'phaseId', type: 'string', format: 'uuid' })
  async listByPhase(@Param('phaseId', ParseUUIDPipe) phaseId: string) {
    return this.matches.listByPhase(phaseId);
  }

  @Public()
  @Throttle(PUBLIC_LIVE_READ_THROTTLE)
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
  async updateStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateMatchStatusDto,
    @Req() req: FastifyRequest,
  ) {
    // Resolved, not assumed. This route carried no actor at all while its
    // summary claimed scorekeeper+ — the global AuthGuard defaults to shadow
    // mode, so an anonymous caller was let through and logged. It now needs the
    // identity the summary always described, and the actor is what decides
    // whether a de-completion may discard later bouts.
    const actor = await this.staff.authorizeMatchScoringWithDiscard(req, id);
    return this.matches.updateStatus(id, dto, actor);
  }

  @Patch('matches/:id/schedule')
  @ApiOperation({ summary: 'Update match scheduled_at and lice_id (organizer+)' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  async scheduleMatch(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ScheduleMatchDto,
    @Req() req: FastifyRequest,
  ) {
    // The summary claimed "(organizer+)" and nothing enforced it. This is the
    // helper the other 14 writes on this controller already use; it resolves
    // the org from the MATCH, so a caller cannot name someone else's event.
    await this.staff.authorizeMatchOrganizer(req, id);
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
    @Req() req: FastifyRequest,
  ) {
    if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) {
      throw new BadRequestException('day query parameter required (YYYY-MM-DD)');
    }
    // Pools carry no event id — the chain is pool → phase → tournament → event.
    await assertCanManagePool(
      { supabase: this.supabase, orgs: this.orgs },
      poolId,
      await resolveRequestUserId(req, this.supabase),
    );
    await this.matches.clearPoolScheduleForDay(poolId, day);
  }

  @Patch('matches/:id')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update lice and/or referee assignment for a match' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateMatchDto,
    @Req() req: FastifyRequest,
  ) {
    await this.staff.authorizeMatchOrganizer(req, id);
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

  @Get('matches/:id/uncomplete-preflight')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'What undoing this result would break, without undoing it (scorekeeper+)',
  })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  async uncompletePreflight(@Param('id', ParseUUIDPipe) id: string, @Req() req: FastifyRequest) {
    const actor = await this.staff.authorizeMatchScoringWithDiscard(req, id);
    return this.matchCompletion.previewUncompletion(id, actor);
  }

  @Post('matches/:id/void')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Void a match (organizer+)' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  async voidMatch(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: FastifyRequest,
    @Body() dto?: { discardDependentResults?: boolean },
  ) {
    // organizer, not scoring: this is the only door out of a completed bout
    // besides a reset, and ARCHITECTURE.md has claimed [organizer+] for it all
    // along while the code checked nothing.
    const actor = await this.staff.authorizeMatchOrganizer(req, id);
    return this.matches.voidMatch(id, actor, dto?.discardDependentResults === true);
  }

  @Post('matches/:id/forfeit')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Record a match forfeit (scorekeeper+) or a result override (organizer+)',
    description:
      'The two halves of this route are gated differently ON PURPOSE. A forfeit is a referee action from the piste, so a scorekeeper or a staff PIN session records it. An override rewrites a finished result and is an organiser action — gated at the same role that can READ the record and VOID it, so the remedy the conflict response names is always available to whoever hit it.',
  })
  async createForfeit(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateMatchForfeitDto,
    @Req() req: FastifyRequest,
  ) {
    const actor = isOverrideReason(dto.reason)
      ? await this.staff.authorizeMatchOrganizer(req, id)
      : await this.staff.authorizeMatchScoring(req, id);
    return this.forfeits.createForfeit(id, dto, actor);
  }

  @Get('matches/:id/forfeit')
  @ApiOperation({
    summary: 'The live forfeit or result override on this match, or null (organizer+)',
    description:
      'Organiser-scoped, not public: it carries the reason a bout was stopped or corrected. One live record per match is a DB invariant, so a second attempt conflicts — this is how the organiser sees the record they must void first.',
  })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  async getActiveForfeit(@Param('id', ParseUUIDPipe) id: string, @Req() req: FastifyRequest) {
    await this.staff.authorizeMatchOrganizer(req, id);
    return this.forfeits.getActiveForfeit(id);
  }

  @Patch('match-forfeits/:id/void')
  @ApiOperation({ summary: 'Void a match forfeit or result override when downstream state allows' })
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

  /**
   * GET /api/v1/matches/:id/audit-log
   *
   * Who changed this match's record, when, and why: exchange voids/reverts and
   * the correction requests filed against it. Organiser-scoped — ids inside the
   * payloads are labelled only when they provably belong to this match.
   */
  @Get('matches/:id/audit-log')
  @ApiOperation({ summary: 'Audit trail for a match (organizer)' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  async listMatchAuditLog(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('limit') limit: string | undefined,
    @Req() req: FastifyRequest,
  ) {
    await this.staff.authorizeMatchOrganizer(req, id);
    const parsed = limit ? Number.parseInt(limit, 10) : undefined;
    return this.matchAudit.listForMatch(id, Number.isFinite(parsed) ? parsed : undefined);
  }

  // ── Exchanges ─────────────────────────────────────────────────────────────────

  @Public()
  @Throttle(PUBLIC_LIVE_READ_THROTTLE)
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
    // …WithDiscard: a reset IS an un-completion, so it needs the capability the
    // pre-flight reports, or an acknowledged reset 403s for everybody.
    const actor = await this.staff.authorizeMatchScoringWithDiscard(req, id);
    return this.matches.resetMatch(id, dto, actor);
  }

  // ── Clock endpoints ───────────────────────────────────────────────────────

  /**
   * GET /api/v1/matches/:id/clock
   * Returns current clock state computed from match_events timeline.
   * Reload-safe: always recomputes from server state.
   */
  // Public alongside /display, /exchanges and /penalties — the projector reads
  // all four anonymously (rationale in common/auth/public-routes.test.ts).
  @Public()
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
    // …WithDiscard for the same reason as the reset: four clock actions
    // un-complete a bout.
    const actor = await this.staff.authorizeMatchScoringWithDiscard(req, id);
    return this.clock.clockAction(
      id,
      dto.action,
      dto.reason,
      actor,
      dto.discardDependentResults === true,
    );
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
