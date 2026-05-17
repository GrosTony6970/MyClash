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
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { SupabaseService } from '../supabase/supabase.service';
import {
  AddLeagueOrganizationRoleDto,
  AddLeagueUserRoleDto,
  CreateLeagueDto,
  LeagueStandingsQueryDto,
  ReviewLeagueTournamentLinkDto,
  UpdateLeagueDto,
} from './dto/leagues.dto';
import { LeaguesService } from './leagues.service';

async function getUserId(req: FastifyRequest, supabase: SupabaseService): Promise<string> {
  const authHeader = req.headers['authorization'];
  const cookies = (req as FastifyRequest & { cookies?: Record<string, string> }).cookies;
  const token = authHeader?.startsWith('Bearer ')
    ? authHeader.slice(7)
    : cookies?.['sb-access-token'];
  if (!token) return 'anonymous';
  const {
    data: { user },
  } = await supabase.anon.auth.getUser(token);
  return user?.id ?? 'anonymous';
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
    @Req() req: FastifyRequest,
  ) {
    const userId = await getUserId(req, this.supabase);
    return this.leagues.addTournamentLink(leagueId, tournamentId, userId);
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

  @Post('admin/leagues/:leagueId/tournaments/:tournamentId/request')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Request tournament attachment to a league' })
  async requestTournamentLink(
    @Param('leagueId', ParseUUIDPipe) leagueId: string,
    @Param('tournamentId', ParseUUIDPipe) tournamentId: string,
    @Req() req: FastifyRequest,
  ) {
    const userId = await getUserId(req, this.supabase);
    return this.leagues.requestTournamentLink(leagueId, tournamentId, userId);
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

  @Patch('admin/league-tournament-links/:linkId')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Approve, reject, or remove a league tournament link' })
  async reviewTournamentLink(
    @Param('linkId', ParseUUIDPipe) linkId: string,
    @Body() dto: ReviewLeagueTournamentLinkDto,
    @Req() req: FastifyRequest,
  ) {
    const userId = await getUserId(req, this.supabase);
    return this.leagues.reviewTournamentLink(linkId, dto.status, userId);
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
