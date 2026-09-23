import {
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
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { FastifyRequest } from 'fastify';
import { assertTournamentMember } from '../../common/auth/event-authz';
import { requireRequestUserId } from '../../common/auth/request-user';
import { PUBLIC_LIVE_READ_THROTTLE } from '../../common/throttling/throttle-profiles';
import { OrganizationsService } from '../organizations/organizations.service';
import { StaffService } from '../staff/staff.service';
import { SupabaseService } from '../supabase/supabase.service';
import {
  AssignPenaltyRulesetDto,
  RejectPenaltyRulesetSharingDto,
  CreatePenaltyDto,
  CreatePenaltyRulesetDto,
  ImportPenaltyRulesetCsvDto,
  PublishPenaltyRulesetDto,
  RollbackPenaltyRulesetDto,
  ReviewPenaltyDto,
  UpdatePenaltyRulesetDto,
  VoidPenaltyDto,
} from './dto/penalties.dto';
import { Public } from '../../common/auth/public.decorator';
import { RulesetImportDto } from '../../common/ruleset-export';
import { PenaltiesService } from './penalties.service';

async function getOptionalUserId(
  req: FastifyRequest,
  supabase: SupabaseService,
): Promise<string | undefined> {
  const authHeader = req.headers['authorization'];
  const cookies = (req as FastifyRequest & { cookies?: Record<string, string> }).cookies;
  const token = authHeader?.startsWith('Bearer ')
    ? authHeader.slice(7)
    : cookies?.['sb-access-token'];
  if (!token) return undefined;
  const {
    data: { user },
  } = await supabase.anon.auth.getUser(token);
  return user?.id;
}

@ApiTags('penalties')
@ApiBearerAuth()
@Controller()
export class PenaltiesController {
  constructor(
    private readonly penalties: PenaltiesService,
    private readonly supabase: SupabaseService,
    private readonly staff: StaffService,
    private readonly orgs: OrganizationsService,
  ) {}

  @Get('penalty-rulesets')
  @ApiOperation({
    summary:
      'List every penalty ruleset on the platform, private ones included (platform staff). Organisers list through organizations/:orgId/penalty-rulesets.',
  })
  async listRulesets(@Req() req: FastifyRequest) {
    return this.penalties.listRulesets(await requireRequestUserId(req, this.supabase));
  }

  @Get('penalty-rulesets/:id')
  @ApiOperation({
    summary:
      'Get a penalty ruleset with entries. Built-in and shared ones for anyone signed in; a private one for an admin of its organisation.',
  })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  async getRuleset(@Param('id', ParseUUIDPipe) id: string, @Req() req: FastifyRequest) {
    return this.penalties.getRulesetFor(id, await requireRequestUserId(req, this.supabase));
  }

  @Get('penalty-rulesets/:id/lineage')
  @ApiOperation({
    summary:
      'How a custom penalty ruleset diverges from the built-in default (computed, never self-declared); null for the built-in.',
  })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  async getRulesetLineage(@Param('id', ParseUUIDPipe) id: string, @Req() req: FastifyRequest) {
    return this.penalties.describeRulesetLineage(
      id,
      await requireRequestUserId(req, this.supabase),
    );
  }

  @Post('penalty-rulesets')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a custom penalty ruleset' })
  async createRuleset(@Body() dto: CreatePenaltyRulesetDto, @Req() req: FastifyRequest) {
    const userId = await getOptionalUserId(req, this.supabase);
    return this.penalties.createRuleset(dto, userId);
  }

  @Post('penalty-rulesets/import-csv')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Import a custom penalty ruleset from CSV' })
  async importRuleset(@Body() dto: ImportPenaltyRulesetCsvDto, @Req() req: FastifyRequest) {
    const userId = await getOptionalUserId(req, this.supabase);
    return this.penalties.importRulesetCsv(dto, userId);
  }

  @Patch('penalty-rulesets/:id')
  @ApiOperation({
    summary:
      'Update a penalty ruleset. Built-in is super-admin-only; custom rulesets are org-admin gated.',
  })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  async updateRuleset(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePenaltyRulesetDto,
    @Req() req: FastifyRequest,
  ) {
    const userId = await getOptionalUserId(req, this.supabase);
    return this.penalties.updateRuleset(id, dto, userId);
  }

  @Delete('penalty-rulesets/:id')
  @ApiOperation({
    summary:
      'Delete a custom penalty ruleset (built-in cannot be deleted). Soft-archives instead of deleting when a tournament or event still pins it.',
  })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  async deleteRuleset(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: FastifyRequest,
  ): Promise<{ archived: boolean }> {
    const userId = await getOptionalUserId(req, this.supabase);
    return this.penalties.deleteRuleset(id, userId);
  }

  @Post('penalty-rulesets/:id/publish')
  @ApiOperation({
    summary:
      'Publish the current definition as an immutable version (validate + snapshot + patch-bump).',
  })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  async publishRuleset(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PublishPenaltyRulesetDto,
    @Req() req: FastifyRequest,
  ) {
    const userId = await getOptionalUserId(req, this.supabase);
    return this.penalties.publishRuleset(id, userId, dto.version);
  }

  @Get('penalty-rulesets/:id/versions')
  @ApiOperation({ summary: 'List the published version history of a penalty ruleset.' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  async listVersions(@Param('id', ParseUUIDPipe) id: string, @Req() req: FastifyRequest) {
    const userId = await getOptionalUserId(req, this.supabase);
    return this.penalties.listVersions(id, userId);
  }

  @Post('penalty-rulesets/:id/rollback')
  @ApiOperation({ summary: 'Restore a prior version snapshot onto the penalty ruleset.' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  async rollbackRuleset(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RollbackPenaltyRulesetDto,
    @Req() req: FastifyRequest,
  ) {
    const userId = await getOptionalUserId(req, this.supabase);
    return this.penalties.rollbackRuleset(id, dto.versionId, userId);
  }

  @Post('penalty-rulesets/:id/submit-for-sharing')
  @ApiOperation({
    summary:
      'Submit an org-owned penalty ruleset for super-admin review so it can be shared platform-wide.',
  })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  async submitForSharing(@Param('id', ParseUUIDPipe) id: string, @Req() req: FastifyRequest) {
    const userId = await getOptionalUserId(req, this.supabase);
    return this.penalties.submitRulesetForSharing(id, userId);
  }

  @Post('penalty-rulesets/:id/approve-sharing')
  @ApiOperation({
    summary: 'Approve a pending sharing request (super-admin); flips public_visibility=true.',
  })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  async approveSharing(@Param('id', ParseUUIDPipe) id: string, @Req() req: FastifyRequest) {
    const userId = await getOptionalUserId(req, this.supabase);
    return this.penalties.approveRulesetSharing(id, userId);
  }

  @Post('penalty-rulesets/:id/reject-sharing')
  @ApiOperation({
    summary: 'Reject a pending sharing request (super-admin) with a reason shown to the organizer.',
  })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  async rejectSharing(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RejectPenaltyRulesetSharingDto,
    @Req() req: FastifyRequest,
  ) {
    const userId = await getOptionalUserId(req, this.supabase);
    return this.penalties.rejectRulesetSharing(id, dto.reason, userId);
  }

  @Get('penalty-rulesets/:id/export')
  @ApiOperation({
    summary: 'Export an org-owned penalty ruleset as a portable, self-contained JSON envelope.',
  })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  async exportRuleset(@Param('id', ParseUUIDPipe) id: string, @Req() req: FastifyRequest) {
    const userId = await getOptionalUserId(req, this.supabase);
    return this.penalties.exportRulesetJson(id, userId);
  }

  @Post('organizations/:orgId/penalty-rulesets/import')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary:
      'Import a penalty ruleset from an export envelope as a new org-owned row (re-validated, hash recomputed).',
  })
  @ApiParam({ name: 'orgId', type: 'string', format: 'uuid' })
  async importRulesetJson(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Body() dto: RulesetImportDto,
    @Req() req: FastifyRequest,
  ) {
    const userId = await getOptionalUserId(req, this.supabase);
    return this.penalties.importRulesetJson(orgId, dto, userId);
  }

  @Get('organizations/:orgId/penalty-rulesets')
  @ApiOperation({
    summary:
      'List penalty rulesets relevant to an organization: built-in + rulesets owned by orgId.',
  })
  @ApiParam({ name: 'orgId', type: 'string', format: 'uuid' })
  async listRulesetsForOrg(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Req() req: FastifyRequest,
  ) {
    const userId = await getOptionalUserId(req, this.supabase);
    return this.penalties.listRulesetsForOrg(orgId, userId);
  }

  @Get('organizations/:orgId/penalty-rulesets/catalog')
  @ApiOperation({
    summary:
      'Discover catalog: adoptable penalty rulesets (built-in + other orgs’ approved-public), attributed by owning-org name.',
  })
  @ApiParam({ name: 'orgId', type: 'string', format: 'uuid' })
  async listRulesetCatalogForOrg(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Req() req: FastifyRequest,
  ) {
    const userId = await getOptionalUserId(req, this.supabase);
    return this.penalties.listRulesetCatalogForOrg(orgId, userId);
  }

  @Patch('events/:id/penalty-ruleset')
  @ApiOperation({ summary: 'Attach a penalty ruleset as event default' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  async assignEventRuleset(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssignPenaltyRulesetDto,
    @Req() req: FastifyRequest,
  ) {
    const userId = await getOptionalUserId(req, this.supabase);
    return this.penalties.assignEventRuleset(id, dto, userId);
  }

  @Patch('tournaments/:id/penalty-ruleset')
  @ApiOperation({ summary: 'Attach a penalty ruleset to a tournament' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  async assignTournamentRuleset(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssignPenaltyRulesetDto,
    @Req() req: FastifyRequest,
  ) {
    const userId = await getOptionalUserId(req, this.supabase);
    return this.penalties.assignTournamentRuleset(id, dto, userId);
  }

  @Public()
  @Throttle(PUBLIC_LIVE_READ_THROTTLE)
  @Get('matches/:id/penalties')
  @ApiOperation({ summary: 'List penalties for a match' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  async listMatchPenalties(@Param('id', ParseUUIDPipe) id: string) {
    return this.penalties.listMatchPenalties(id);
  }

  @Get('matches/:id/penalty-ruleset')
  @ApiOperation({ summary: 'Get the effective penalty ruleset for a match' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  async getMatchPenaltyRuleset(@Param('id', ParseUUIDPipe) id: string, @Req() req: FastifyRequest) {
    // The scoring pad reads it beside `penalty-scope`, so the same check.
    await this.staff.authorizeMatchScoring(req, id);
    return this.penalties.getEffectiveRulesetForMatch(id);
  }

  /**
   * NOT `@Public()`, unlike `/matches/:id/penalties` beside it. That one is a
   * per-match list a spectator display legitimately reads; this aggregates a
   * fighter's cards across a whole tournament, and staff data gets a staff
   * check. `authorizeMatchScoring` is match-scoped authorisation, not a
   * signed-in test — the distinction the referees sweep was about.
   */
  @Get('matches/:id/penalty-scope')
  @ApiOperation({
    summary:
      'Prior penalties the two fighters are accumulating against, in the ruleset’s scope. Lets the scoring pad resolve the next card the same way the server will.',
  })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  async getMatchPenaltyScope(@Param('id', ParseUUIDPipe) id: string, @Req() req: FastifyRequest) {
    await this.staff.authorizeMatchScoring(req, id);
    return this.penalties.getPenaltyScopeForMatch(id);
  }

  @Get('tournaments/:id/penalty-ruleset')
  @ApiOperation({ summary: 'Get the effective penalty ruleset for a tournament' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  async getTournamentPenaltyRuleset(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: FastifyRequest,
  ) {
    await this.assertTournamentReader(req, id);
    return this.penalties.getEffectiveRulesetForTournament(id);
  }

  @Post('matches/:id/penalties')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Record a match penalty card' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  async createPenalty(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreatePenaltyDto,
    @Req() req: FastifyRequest,
  ) {
    const actor = await this.staff.authorizeMatchScoring(req, id);
    return this.penalties.createPenalty(id, dto, actor);
  }

  @Patch('match-penalties/:id/void')
  @ApiOperation({ summary: 'Void a match penalty without deleting it' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  async voidPenalty(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: VoidPenaltyDto,
    @Req() req: FastifyRequest,
  ) {
    const actor = await this.staff.authorizePenaltyScoring(req, id);
    return this.penalties.voidPenalty(id, dto, actor);
  }

  @Get('tournaments/:id/penalty-reviews')
  @ApiOperation({ summary: 'List pending penalty reviews for a tournament' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  async listTournamentReviews(@Param('id', ParseUUIDPipe) id: string, @Req() req: FastifyRequest) {
    await this.assertTournamentReader(req, id);
    return this.penalties.listTournamentReviews(id);
  }

  @Patch('tournament-penalty-reviews/:id')
  @ApiOperation({ summary: 'Confirm or dismiss a tournament penalty review' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  async reviewTournamentPenalty(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReviewPenaltyDto,
    @Req() req: FastifyRequest,
  ) {
    const userId = await getOptionalUserId(req, this.supabase);
    return this.penalties.reviewTournamentPenalty(id, dto, userId);
  }

  /** Any member of the organisation of the Tournament's own Event; 401 first. */
  private async assertTournamentReader(req: FastifyRequest, tournamentId: string): Promise<void> {
    const userId = await requireRequestUserId(req, this.supabase);
    await assertTournamentMember(
      { supabase: this.supabase, orgs: this.orgs },
      tournamentId,
      userId,
    );
  }
}
