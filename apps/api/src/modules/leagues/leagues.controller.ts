import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { SupabaseService } from '../supabase/supabase.service';
import {
  AddLeagueOrganizationRoleDto,
  AddLeagueUserRoleDto,
  CreateLeagueDto,
  LeagueGroupDto,
  LeagueStandingsQueryDto,
  LinkTournamentDto,
  ReviewLeagueTournamentLinkDto,
  UpdateLeagueDto,
  UpdateLeagueGroupDto,
} from './dto/leagues.dto';
import { LeaguesService } from './leagues.service';

async function getUserId(req: FastifyRequest, supabase: SupabaseService): Promise<string> {
  const authHeader = req.headers['authorization'];
  const cookies = (req as FastifyRequest & { cookies?: Record<string, string> }).cookies;
  const token = authHeader?.startsWith('Bearer ')
    ? authHeader.slice(7)
    : cookies?.['sb-access-token'];
  if (!token) throw new UnauthorizedException('Authentication required');
  const user = await supabase.getAuthUser(token);
  if (!user?.id) throw new UnauthorizedException('Authentication required');
  return user.id;
}

@ApiTags('leagues')
@Controller()
export class LeaguesController {
  constructor(
    private readonly leagues: LeaguesService,
    private readonly supabase: SupabaseService,
  ) {}

  @Get('leagues')
  @ApiOperation({ summary: 'List public leagues' })
  async listPublic(@Query('seasonYear') seasonYear?: string) {
    return this.leagues.listPublic(seasonYear ? Number(seasonYear) : undefined);
  }

  @Get('leagues/attachable')
  @ApiOperation({
    summary: 'List leagues a tournament organizer can request to attach to (drafts + published).',
  })
  async listAttachable() {
    return this.leagues.listAttachable();
  }

  @Get('leagues/:slug')
  @ApiOperation({ summary: 'Get public league by slug' })
  async getPublic(@Param('slug') slug: string) {
    return this.leagues.getPublicBySlug(slug);
  }

  @Get('leagues/:leagueId/standings')
  @ApiOperation({ summary: 'Get public league standings' })
  @ApiParam({ name: 'leagueId', type: 'string', format: 'uuid' })
  async standings(
    @Param('leagueId', ParseUUIDPipe) leagueId: string,
    @Query() query: LeagueStandingsQueryDto,
  ) {
    return this.leagues.standings(leagueId, query.group);
  }

  @Get('leagues/:leagueId/final-report.csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @ApiOperation({ summary: 'Export league final report as CSV' })
  async finalReportCsv(@Param('leagueId', ParseUUIDPipe) leagueId: string) {
    return this.leagues.finalReportCsv(leagueId);
  }

  @Get('leagues/:leagueId/final-report.print.html')
  @Header('Content-Type', 'text/html; charset=utf-8')
  @ApiOperation({ summary: 'Export printable league final report' })
  async finalReportHtml(@Param('leagueId', ParseUUIDPipe) leagueId: string) {
    return this.leagues.finalReportHtml(leagueId);
  }

  @Get('admin/leagues')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List leagues manageable by the current user' })
  async listManageable(@Req() req: FastifyRequest) {
    const userId = await getUserId(req, this.supabase);
    return this.leagues.listManageable(userId);
  }

  @Get('admin/leagues/:leagueId/standings')
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Get league standings for the admin Ranking page (auth-gated on league-manage permissions; bypasses the public-visibility gate the /leagues/:leagueId/standings public endpoint enforces)',
  })
  @ApiParam({ name: 'leagueId', type: 'string', format: 'uuid' })
  async adminStandings(
    @Param('leagueId', ParseUUIDPipe) leagueId: string,
    @Query() query: LeagueStandingsQueryDto,
    @Req() req: FastifyRequest,
  ) {
    const userId = await getUserId(req, this.supabase);
    return this.leagues.adminStandings(leagueId, userId, query.group);
  }

  @Post('admin/leagues')
  @HttpCode(HttpStatus.CREATED)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create league' })
  async create(@Body() dto: CreateLeagueDto, @Req() req: FastifyRequest) {
    const userId = await getUserId(req, this.supabase);
    return this.leagues.create(dto, userId);
  }

  @Patch('admin/leagues/:leagueId')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update league' })
  async update(
    @Param('leagueId', ParseUUIDPipe) leagueId: string,
    @Body() dto: UpdateLeagueDto,
    @Req() req: FastifyRequest,
  ) {
    const userId = await getUserId(req, this.supabase);
    return this.leagues.update(leagueId, dto, userId);
  }

  @Delete('admin/leagues/:leagueId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete a league' })
  async deleteLeague(
    @Param('leagueId', ParseUUIDPipe) leagueId: string,
    @Req() req: FastifyRequest,
  ) {
    const userId = await getUserId(req, this.supabase);
    return this.leagues.delete(leagueId, userId);
  }

  @Delete('admin/leagues/:leagueId/events/:eventId/tournament-links')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Remove all tournament links for an event from a league' })
  async removeEventTournamentLinks(
    @Param('leagueId', ParseUUIDPipe) leagueId: string,
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Req() req: FastifyRequest,
  ) {
    const userId = await getUserId(req, this.supabase);
    return this.leagues.removeEventTournamentLinks(leagueId, eventId, userId);
  }

  @Post('admin/leagues/:leagueId/tournaments/:tournamentId/link')
  @HttpCode(HttpStatus.CREATED)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Admin direct-add a tournament to a league (approved immediately)' })
  async addTournamentLink(
    @Param('leagueId', ParseUUIDPipe) leagueId: string,
    @Param('tournamentId', ParseUUIDPipe) tournamentId: string,
    @Body() dto: LinkTournamentDto,
    @Req() req: FastifyRequest,
  ) {
    const userId = await getUserId(req, this.supabase);
    return this.leagues.addTournamentLink(leagueId, tournamentId, userId, dto?.groupId ?? null);
  }

  @Post('admin/leagues/:leagueId/events/:eventId/link')
  @HttpCode(HttpStatus.CREATED)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Admin direct-add all tournaments from an event to a league' })
  async addEventTournamentLinks(
    @Param('leagueId', ParseUUIDPipe) leagueId: string,
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Req() req: FastifyRequest,
  ) {
    const userId = await getUserId(req, this.supabase);
    return this.leagues.addEventTournamentLinks(leagueId, eventId, userId);
  }

  @Post('admin/leagues/:leagueId/organization-roles')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Grant an organization a league role' })
  async addOrganizationRole(
    @Param('leagueId', ParseUUIDPipe) leagueId: string,
    @Body() dto: AddLeagueOrganizationRoleDto,
    @Req() req: FastifyRequest,
  ) {
    const userId = await getUserId(req, this.supabase);
    return this.leagues.addOrganizationRole(leagueId, dto, userId);
  }

  @Get('admin/leagues/:leagueId/organization-roles')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List organizations linked to a league' })
  async listOrganizationRoles(
    @Param('leagueId', ParseUUIDPipe) leagueId: string,
    @Req() req: FastifyRequest,
  ) {
    const userId = await getUserId(req, this.supabase);
    return this.leagues.listOrganizationRoles(leagueId, userId);
  }

  @Delete('admin/leagues/:leagueId/organization-roles/:organizationId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Remove an organization from a league' })
  async removeOrganizationRole(
    @Param('leagueId', ParseUUIDPipe) leagueId: string,
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Req() req: FastifyRequest,
  ) {
    const userId = await getUserId(req, this.supabase);
    return this.leagues.removeOrganizationRole(leagueId, organizationId, userId);
  }

  @Post('admin/leagues/:leagueId/user-roles')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Grant a user a league role' })
  async addUserRole(
    @Param('leagueId', ParseUUIDPipe) leagueId: string,
    @Body() dto: AddLeagueUserRoleDto,
    @Req() req: FastifyRequest,
  ) {
    const userId = await getUserId(req, this.supabase);
    return this.leagues.addUserRole(leagueId, dto, userId);
  }

  @Get('admin/leagues/:leagueId/user-roles')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List users with a role in a league' })
  async listUserRoles(
    @Param('leagueId', ParseUUIDPipe) leagueId: string,
    @Req() req: FastifyRequest,
  ) {
    const userId = await getUserId(req, this.supabase);
    return this.leagues.listUserRoles(leagueId, userId);
  }

  @Delete('admin/leagues/:leagueId/user-roles/:targetUserId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Remove a user from a league role' })
  async removeUserRole(
    @Param('leagueId', ParseUUIDPipe) leagueId: string,
    @Param('targetUserId', ParseUUIDPipe) targetUserId: string,
    @Req() req: FastifyRequest,
  ) {
    const userId = await getUserId(req, this.supabase);
    return this.leagues.removeUserRole(leagueId, targetUserId, userId);
  }

  @Post('admin/leagues/:leagueId/logo')
  @HttpCode(HttpStatus.CREATED)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Upload a league logo (PNG/JPEG/WebP, 10 MB max)' })
  async uploadLogo(@Param('leagueId', ParseUUIDPipe) leagueId: string, @Req() req: FastifyRequest) {
    const userId = await getUserId(req, this.supabase);
    const data = await (
      req as FastifyRequest & {
        file: () => Promise<
          { filename: string; mimetype: string; toBuffer: () => Promise<Buffer> } | undefined
        >;
      }
    ).file();
    const buffer = data ? await data.toBuffer() : Buffer.alloc(0);
    return this.leagues.uploadLogo(
      leagueId,
      {
        buffer,
        filename: data?.filename ?? '',
        mimetype: data?.mimetype ?? '',
      },
      userId,
    );
  }

  @Delete('admin/leagues/:leagueId/logo')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Remove a league logo' })
  async deleteLogo(@Param('leagueId', ParseUUIDPipe) leagueId: string, @Req() req: FastifyRequest) {
    const userId = await getUserId(req, this.supabase);
    return this.leagues.deleteLogo(leagueId, userId);
  }

  @Post('admin/leagues/:leagueId/tournaments/:tournamentId/request')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Request tournament attachment to a league' })
  async requestTournamentLink(
    @Param('leagueId', ParseUUIDPipe) leagueId: string,
    @Param('tournamentId', ParseUUIDPipe) tournamentId: string,
    @Body() dto: LinkTournamentDto,
    @Req() req: FastifyRequest,
  ) {
    const userId = await getUserId(req, this.supabase);
    return this.leagues.requestTournamentLink(leagueId, tournamentId, userId, dto?.groupId ?? null);
  }

  @Get('admin/leagues/:leagueId/tournament-links')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List tournament attachment requests for a league' })
  async listTournamentLinks(
    @Param('leagueId', ParseUUIDPipe) leagueId: string,
    @Req() req: FastifyRequest,
  ) {
    const userId = await getUserId(req, this.supabase);
    return this.leagues.listTournamentLinks(leagueId, userId);
  }

  @Get('admin/leagues/:leagueId/requests')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'List league requests (tournament-attach + future membership requests)',
  })
  async listLeagueRequests(
    @Param('leagueId', ParseUUIDPipe) leagueId: string,
    @Query('status') status: string | undefined,
    @Req() req: FastifyRequest,
  ) {
    const userId = await getUserId(req, this.supabase);
    const allowed = ['requested', 'approved', 'rejected'] as const;
    const normalised = (allowed as readonly string[]).includes(status ?? '')
      ? (status as (typeof allowed)[number])
      : undefined;
    return this.leagues.listLeagueRequests(leagueId, userId, normalised);
  }

  @Patch('admin/league-tournament-links/:linkId')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Approve, reject, remove, or reassign-to-group a league tournament link',
  })
  async reviewTournamentLink(
    @Param('linkId', ParseUUIDPipe) linkId: string,
    @Body() dto: ReviewLeagueTournamentLinkDto,
    @Req() req: FastifyRequest,
  ) {
    const userId = await getUserId(req, this.supabase);
    return this.leagues.reviewTournamentLink(
      linkId,
      { status: dto.status, groupId: dto.groupId },
      userId,
    );
  }

  // ── Event-side leagues views (organizer surface) ──────────────────────

  @Get('events/:eventId/league-attachments')
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'List non-removed league-tournament links for an event. Powers the organizer Requests + Memberships tabs.',
  })
  async listEventLeagueAttachments(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Req() req: FastifyRequest,
  ) {
    const userId = await getUserId(req, this.supabase);
    return this.leagues.listEventLeagueAttachments(eventId, userId);
  }

  @Patch('admin/events/:eventId/league-tournament-links/:linkId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Operator self-detach: withdraw a pending request or leave an approved attachment. Flips link to status=removed.',
  })
  async selfDetachTournamentLink(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Param('linkId', ParseUUIDPipe) linkId: string,
    @Req() req: FastifyRequest,
  ) {
    const userId = await getUserId(req, this.supabase);
    await this.leagues.selfDetachTournamentLink(eventId, linkId, userId);
  }

  @Get('leagues/:leagueId/member-events')
  @ApiOperation({
    summary:
      'Public: list events whose tournaments have an approved link to the league (Memberships tab sibling list).',
  })
  async listLeagueMemberEvents(@Param('leagueId', ParseUUIDPipe) leagueId: string) {
    return this.leagues.listLeagueMemberEvents(leagueId);
  }

  // ── Groups ────────────────────────────────────────────────────────────

  @Get('leagues/:leagueId/groups')
  @ApiOperation({
    summary:
      'List groups defined for a league (public — used by organizers picking a group when requesting attachment).',
  })
  async listLeagueGroupsPublic(@Param('leagueId', ParseUUIDPipe) leagueId: string) {
    return this.leagues.listGroups(leagueId);
  }

  @Get('admin/leagues/:leagueId/groups')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List groups defined for a league (admin view).' })
  async listLeagueGroups(@Param('leagueId', ParseUUIDPipe) leagueId: string) {
    return this.leagues.listGroups(leagueId);
  }

  @Post('admin/leagues/:leagueId/groups')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a league group.' })
  async createLeagueGroup(
    @Param('leagueId', ParseUUIDPipe) leagueId: string,
    @Body() dto: LeagueGroupDto,
    @Req() req: FastifyRequest,
  ) {
    const userId = await getUserId(req, this.supabase);
    return this.leagues.createGroup(leagueId, dto, userId);
  }

  @Patch('admin/league-groups/:groupId')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update a league group.' })
  async updateLeagueGroup(
    @Param('groupId', ParseUUIDPipe) groupId: string,
    @Body() dto: UpdateLeagueGroupDto,
    @Req() req: FastifyRequest,
  ) {
    const userId = await getUserId(req, this.supabase);
    return this.leagues.updateGroup(groupId, dto, userId);
  }

  @Delete('admin/league-groups/:groupId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete a league group.' })
  async deleteLeagueGroup(
    @Param('groupId', ParseUUIDPipe) groupId: string,
    @Req() req: FastifyRequest,
  ) {
    const userId = await getUserId(req, this.supabase);
    await this.leagues.deleteGroup(groupId, userId);
  }

  @Post('admin/leagues/:leagueId/recompute')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Manually recompute league rankings' })
  async recomputeLeague(
    @Param('leagueId', ParseUUIDPipe) leagueId: string,
    @Req() req: FastifyRequest,
  ) {
    const userId = await getUserId(req, this.supabase);
    return this.leagues.recomputeLeagueRankings(leagueId, userId);
  }

  @Post('admin/events/:eventId/leagues/recompute')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Manually recompute league rankings for an event' })
  async recomputeEvent(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Req() req: FastifyRequest,
  ) {
    const userId = await getUserId(req, this.supabase);
    return this.leagues.recomputeForEvent(eventId, userId);
  }
}
