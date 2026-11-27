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
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { assertTournamentMember } from '../../common/auth/event-authz';
import { assertCanManageTournament } from '../../common/auth/registration-authz';
import { requireRequestUserId } from '../../common/auth/request-user';
import { BlockOnCompletedEvent } from '../../common/event-readonly/block-on-completed.decorator';
import { NO_UPLOAD, readUpload } from '../../common/read-upload';
import { EVENT_LOGO_UPLOAD } from '../events/event-assets';
import { OrganizationsService } from '../organizations/organizations.service';
import { SupabaseService } from '../supabase/supabase.service';
import { CreateTeamDto, UpdateTeamDto } from './dto/teams.dto';
import { TeamsService } from './teams.service';

/**
 * The teams of a team Tournament. The Registrations' two bars: reading needs membership of the
 * Event's organisation at any role, changing needs `editor`, both checked on the Tournament of the
 * URL (`tournaments/:tournamentId/…`, which also places the route for the archived-Event lock).
 * The service holds every team id to that Tournament. The writes are refused once the Event is
 * completed, as the Pool writes are (`phases.controller.ts`).
 */
@ApiTags('teams')
@ApiBearerAuth()
@Controller()
export class TeamsController {
  constructor(
    private readonly teams: TeamsService,
    private readonly supabase: SupabaseService,
    private readonly organizations: OrganizationsService,
  ) {}

  /** Deps in the shape `event-authz` takes. */
  private get authz() {
    return { supabase: this.supabase, orgs: this.organizations };
  }

  private async assertEditor(req: FastifyRequest, tournamentId: string): Promise<void> {
    const userId = await requireRequestUserId(req, this.supabase);
    await assertCanManageTournament(this.authz, tournamentId, userId);
  }

  /** GET /api/v1/tournaments/:tournamentId/teams */
  @Get('tournaments/:tournamentId/teams')
  @ApiOperation({ summary: 'List the teams of a team Tournament' })
  @ApiParam({ name: 'tournamentId', type: 'string', format: 'uuid' })
  async list(
    @Param('tournamentId', ParseUUIDPipe) tournamentId: string,
    @Req() req: FastifyRequest,
  ) {
    const userId = await requireRequestUserId(req, this.supabase);
    await assertTournamentMember(this.authz, tournamentId, userId);
    return this.teams.list(tournamentId);
  }

  /** POST /api/v1/tournaments/:tournamentId/teams */
  @BlockOnCompletedEvent()
  @Post('tournaments/:tournamentId/teams')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a team (slug from its name; size defaults to the Tournament)' })
  @ApiParam({ name: 'tournamentId', type: 'string', format: 'uuid' })
  async create(
    @Param('tournamentId', ParseUUIDPipe) tournamentId: string,
    @Body() dto: CreateTeamDto,
    @Req() req: FastifyRequest,
  ) {
    await this.assertEditor(req, tournamentId);
    return this.teams.create(tournamentId, dto);
  }

  /** PATCH /api/v1/tournaments/:tournamentId/teams/:teamId */
  @BlockOnCompletedEvent()
  @Patch('tournaments/:tournamentId/teams/:teamId')
  @ApiOperation({ summary: 'Save a team (size fixed once a bout of the team has started)' })
  @ApiParam({ name: 'tournamentId', type: 'string', format: 'uuid' })
  @ApiParam({ name: 'teamId', type: 'string', format: 'uuid' })
  async update(
    @Param('tournamentId', ParseUUIDPipe) tournamentId: string,
    @Param('teamId', ParseUUIDPipe) teamId: string,
    @Body() dto: UpdateTeamDto,
    @Req() req: FastifyRequest,
  ) {
    await this.assertEditor(req, tournamentId);
    return this.teams.update(tournamentId, teamId, dto);
  }

  /** DELETE /api/v1/tournaments/:tournamentId/teams/:teamId */
  @BlockOnCompletedEvent()
  @Delete('tournaments/:tournamentId/teams/:teamId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a team (409 while a bout names it)' })
  @ApiParam({ name: 'tournamentId', type: 'string', format: 'uuid' })
  @ApiParam({ name: 'teamId', type: 'string', format: 'uuid' })
  async remove(
    @Param('tournamentId', ParseUUIDPipe) tournamentId: string,
    @Param('teamId', ParseUUIDPipe) teamId: string,
    @Req() req: FastifyRequest,
  ) {
    await this.assertEditor(req, tournamentId);
    await this.teams.remove(tournamentId, teamId);
  }

  /** POST /api/v1/tournaments/:tournamentId/teams/:teamId/logo */
  @BlockOnCompletedEvent()
  @Post('tournaments/:tournamentId/teams/:teamId/logo')
  @HttpCode(HttpStatus.CREATED)
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } },
  })
  @ApiOperation({ summary: 'Upload a team logo (PNG, JPEG or WebP, 10 MB)' })
  @ApiParam({ name: 'tournamentId', type: 'string', format: 'uuid' })
  @ApiParam({ name: 'teamId', type: 'string', format: 'uuid' })
  async uploadLogo(
    @Param('tournamentId', ParseUUIDPipe) tournamentId: string,
    @Param('teamId', ParseUUIDPipe) teamId: string,
    @Req() req: FastifyRequest,
  ) {
    await this.assertEditor(req, tournamentId);
    const upload = (await readUpload(req, EVENT_LOGO_UPLOAD)) ?? NO_UPLOAD;
    return this.teams.uploadLogo(tournamentId, teamId, upload);
  }
}
