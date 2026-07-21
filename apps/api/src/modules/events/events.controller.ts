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
  Query,
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
import { SupabaseService } from '../supabase/supabase.service';
import {
  CreateEventDto,
  CreateTournamentDto,
  EventClubQueryDto,
  EventQueryDto,
  SubmitEventClubRequestDto,
  UpsertEventThemeDto,
  UpdateEventDto,
  UpdateTournamentDto,
} from './dto/events.dto';
import { EventThemesService } from './event-themes.service';
import { Public } from '../../common/auth/public.decorator';
import { EventsService } from './events.service';

async function getUserId(req: FastifyRequest, supabase: SupabaseService): Promise<string> {
  const authHeader = req.headers['authorization'];
  const cookies = (req as FastifyRequest & { cookies?: Record<string, string> }).cookies;
  const token = authHeader?.startsWith('Bearer ')
    ? authHeader.slice(7)
    : cookies?.['sb-access-token'];
  if (!token) return 'anonymous';
  const user = await supabase.getAuthUser(token);
  return user?.id ?? 'anonymous';
}

@ApiTags('events')
@Controller()
export class EventsController {
  constructor(
    private readonly events: EventsService,
    private readonly supabase: SupabaseService,
    private readonly eventThemes: EventThemesService,
  ) {}

  // ── Events ───────────────────────────────────────────────────────────────────

  /** GET /api/v1/events?status=...&organizationId=... */
  @Public()
  @Get('events')
  @ApiOperation({ summary: 'List events (public, filtered)' })
  async listEvents(@Query() query: EventQueryDto) {
    return this.events.listEvents(query);
  }

  /** GET /api/v1/events/:eventId/dashboard-stats */
  @Get('events/:eventId/dashboard-stats')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get organizer event dashboard statistics' })
  @ApiParam({ name: 'eventId', type: 'string', format: 'uuid' })
  async getEventDashboardStats(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Req() req: FastifyRequest,
  ) {
    const userId = await getUserId(req, this.supabase);
    return this.events.getEventDashboardStats(eventId, userId);
  }

  /** GET /api/v1/events/:eventId/clubs?scope=all|event&q=... */
  @Get('events/:eventId/clubs')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List clubs with selected-event participation context' })
  @ApiParam({ name: 'eventId', type: 'string', format: 'uuid' })
  async listEventClubs(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Query() query: EventClubQueryDto,
    @Req() req: FastifyRequest,
  ) {
    const userId = await getUserId(req, this.supabase);
    return this.events.listEventClubs(eventId, query, userId);
  }

  /** POST /api/v1/events/:eventId/club-requests */
  @Post('events/:eventId/club-requests')
  @HttpCode(HttpStatus.CREATED)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Submit a missing club for super-admin review' })
  @ApiParam({ name: 'eventId', type: 'string', format: 'uuid' })
  async submitClubReviewRequest(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Body() dto: SubmitEventClubRequestDto,
    @Req() req: FastifyRequest,
  ) {
    const userId = await getUserId(req, this.supabase);
    return this.events.submitClubReviewRequest(eventId, dto, userId);
  }

  /** GET /api/v1/events/:slug */
  @Public()
  @Get('events/:slug')
  @ApiOperation({ summary: 'Get event by slug (public)' })
  async getEvent(@Param('slug') slug: string) {
    return this.events.getEventBySlug(slug);
  }

  /** GET /api/v1/events/:eventSlug/tournaments/:tournamentSlug/standings */
  @Public()
  @Get('events/:eventSlug/tournaments/:tournamentSlug/standings')
  @ApiOperation({ summary: 'Get public tournament pools and bracket, respecting phase visibility' })
  async getPublicTournamentStandings(
    @Param('eventSlug') eventSlug: string,
    @Param('tournamentSlug') tournamentSlug: string,
  ) {
    return this.events.getPublicTournamentStandings(eventSlug, tournamentSlug);
  }

  /** GET /api/v1/events/:eventSlug/tournaments/:tournamentSlug/pools-with-matches */
  @Public()
  @Get('events/:eventSlug/tournaments/:tournamentSlug/pools-with-matches')
  @ApiOperation({ summary: 'Public per-pool matches list (read-only) for the spectator page' })
  async getPublicTournamentPoolsWithMatches(
    @Param('eventSlug') eventSlug: string,
    @Param('tournamentSlug') tournamentSlug: string,
  ) {
    return this.events.getPublicTournamentPoolsWithMatches(eventSlug, tournamentSlug);
  }

  /** GET /api/v1/organizations/:orgId/events */
  @Get('organizations/:orgId/events')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'List events for an organization (org member+, includes drafts/archived)',
  })
  @ApiParam({ name: 'orgId', type: 'string', format: 'uuid' })
  async listOrgEvents(@Param('orgId', ParseUUIDPipe) orgId: string, @Req() req: FastifyRequest) {
    const userId = await getUserId(req, this.supabase);
    return this.events.listOrgEvents(orgId, userId);
  }

  /** POST /api/v1/organizations/:orgId/events */
  @Post('organizations/:orgId/events')
  @HttpCode(HttpStatus.CREATED)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create event (org admin+)' })
  @ApiParam({ name: 'orgId', type: 'string', format: 'uuid' })
  async createEvent(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Body() dto: CreateEventDto,
    @Req() req: FastifyRequest,
  ) {
    const userId = await getUserId(req, this.supabase);
    return this.events.createEvent(orgId, dto, userId);
  }

  /** PATCH /api/v1/events/:id */
  @Patch('events/:id')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update event (org admin+)' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  async updateEvent(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateEventDto,
    @Req() req: FastifyRequest,
  ) {
    const userId = await getUserId(req, this.supabase);
    return this.events.updateEvent(id, dto, userId);
  }

  /** POST /api/v1/events/:id/publish */
  @Post('events/:id/publish')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Publish event (org admin+)' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  async publishEvent(@Param('id', ParseUUIDPipe) id: string, @Req() req: FastifyRequest) {
    const userId = await getUserId(req, this.supabase);
    return this.events.publishEvent(id, userId);
  }

  /** POST /api/v1/events/:id/unpublish */
  @Post('events/:id/unpublish')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Unpublish event back to draft (org admin+)' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  async unpublishEvent(@Param('id', ParseUUIDPipe) id: string, @Req() req: FastifyRequest) {
    const userId = await getUserId(req, this.supabase);
    return this.events.unpublishEvent(id, userId);
  }

  /** DELETE /api/v1/events/:id?mode=hard */
  @Delete('events/:id')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Hard delete event (org admin+)' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  async deleteEvent(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('mode') mode: string | undefined,
    @Req() req: FastifyRequest,
  ) {
    const userId = await getUserId(req, this.supabase);
    return this.events.deleteEvent(id, mode, userId);
  }

  /** GET /api/v1/events/:eventId/theme */
  @Get('events/:eventId/theme')
  @ApiOperation({ summary: 'Get event theme' })
  @ApiParam({ name: 'eventId', type: 'string', format: 'uuid' })
  async getTheme(@Param('eventId', ParseUUIDPipe) eventId: string) {
    return this.eventThemes.getTheme(eventId);
  }

  /** POST /api/v1/events/:eventId/theme */
  @Post('events/:eventId/theme')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create or update event theme (org admin+)' })
  @ApiParam({ name: 'eventId', type: 'string', format: 'uuid' })
  async postTheme(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Body() dto: UpsertEventThemeDto,
    @Req() req: FastifyRequest,
  ) {
    const userId = await getUserId(req, this.supabase);
    return this.eventThemes.upsertTheme(eventId, dto, userId);
  }

  // The legacy `PUT events/:eventId/theme` + `POST events/:eventId/theme/logo`
  // handlers were removed — no frontend called them: theme writes go through
  // `POST .../theme` and uploads through `events/:id/logo` + `events/:id/hero`
  // (per-event colors were retired in migration 0086).

  /** POST /api/v1/events/:id/logo — events-list logo (separate from theme logo). */
  @Post('events/:id/logo')
  @HttpCode(HttpStatus.CREATED)
  @ApiBearerAuth()
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } },
  })
  @ApiOperation({ summary: 'Upload event logo (org admin+)' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  async uploadEventLogo(@Param('id', ParseUUIDPipe) id: string, @Req() req: FastifyRequest) {
    const userId = await getUserId(req, this.supabase);
    const data = await (
      req as FastifyRequest & {
        file: () => Promise<
          | {
              filename: string;
              mimetype: string;
              toBuffer: () => Promise<Buffer>;
            }
          | undefined
        >;
      }
    ).file();
    const buffer = data ? await data.toBuffer() : Buffer.alloc(0);
    return this.events.uploadLogo(id, userId, {
      buffer,
      filename: data?.filename ?? '',
      mimetype: data?.mimetype ?? '',
    });
  }

  /** POST /api/v1/events/:id/hero — per-event hero image stored on themes.hero_image_url. */
  @Post('events/:id/hero')
  @HttpCode(HttpStatus.CREATED)
  @ApiBearerAuth()
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } },
  })
  @ApiOperation({ summary: 'Upload event hero image (org admin+)' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  async uploadEventHero(@Param('id', ParseUUIDPipe) id: string, @Req() req: FastifyRequest) {
    const userId = await getUserId(req, this.supabase);
    const data = await (
      req as FastifyRequest & {
        file: () => Promise<
          | {
              filename: string;
              mimetype: string;
              toBuffer: () => Promise<Buffer>;
            }
          | undefined
        >;
      }
    ).file();
    const buffer = data ? await data.toBuffer() : Buffer.alloc(0);
    return this.events.uploadHero(id, userId, {
      buffer,
      filename: data?.filename ?? '',
      mimetype: data?.mimetype ?? '',
    });
  }

  // ── Tournaments ───────────────────────────────────────────────────────────────

  /** GET /api/v1/events/:eventId/tournaments */
  @Public()
  @Get('events/:eventId/tournaments')
  @ApiOperation({ summary: 'List tournaments for an event (public)' })
  @ApiParam({ name: 'eventId', type: 'string', format: 'uuid' })
  async listTournaments(@Param('eventId', ParseUUIDPipe) eventId: string) {
    return this.events.listTournaments(eventId);
  }

  /**
   * GET /api/v1/events/:eventSlug/participants — public roster.
   *
   * Slug-based to match the rest of the public surface (standings,
   * live-state…). Returns one row per person with the tournaments they
   * are registered in; withdrawn / disqualified entries are excluded.
   */
  @Public()
  @Get('events/:eventSlug/participants')
  @ApiOperation({ summary: 'List participants for an event (public)' })
  @ApiParam({ name: 'eventSlug', type: 'string' })
  async listParticipants(
    @Param('eventSlug') eventSlug: string,
    @Query('includeStaff') includeStaff?: string,
  ) {
    return this.events.listPublicParticipants(eventSlug, {
      includeStaff: includeStaff === 'true',
    });
  }

  /** POST /api/v1/events/:eventId/tournaments */
  @Post('events/:eventId/tournaments')
  @HttpCode(HttpStatus.CREATED)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create tournament (org admin+)' })
  @ApiParam({ name: 'eventId', type: 'string', format: 'uuid' })
  async createTournament(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Body() dto: CreateTournamentDto,
    @Req() req: FastifyRequest,
  ) {
    const userId = await getUserId(req, this.supabase);
    return this.events.createTournament(eventId, dto, userId);
  }

  /**
   * GET /api/v1/tournaments/:id
   *
   * Returns the full tournament row. The tournament-creation wizard fetches
   * this on step 2 to hydrate the match-format form against the row just
   * created — without it the wizard 404s and shows the "Draft — step 2 of 4"
   * resume banner instead of letting the operator continue.
   */
  @Get('tournaments/:id')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get tournament (org scorekeeper+)' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  async getTournament(@Param('id', ParseUUIDPipe) id: string, @Req() req: FastifyRequest) {
    const userId = await getUserId(req, this.supabase);
    return this.events.getTournamentById(id, userId);
  }

  /** POST /api/v1/tournaments/:id/logo — per-tournament logo upload. */
  @Post('tournaments/:id/logo')
  @HttpCode(HttpStatus.CREATED)
  @ApiBearerAuth()
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } },
  })
  @ApiOperation({ summary: 'Upload tournament logo (org admin+)' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  async uploadTournamentLogo(@Param('id', ParseUUIDPipe) id: string, @Req() req: FastifyRequest) {
    const userId = await getUserId(req, this.supabase);
    const data = await (
      req as FastifyRequest & {
        file: () => Promise<
          | {
              filename: string;
              mimetype: string;
              toBuffer: () => Promise<Buffer>;
            }
          | undefined
        >;
      }
    ).file();
    const buffer = data ? await data.toBuffer() : Buffer.alloc(0);
    return this.events.uploadTournamentLogo(id, userId, {
      buffer,
      filename: data?.filename ?? '',
      mimetype: data?.mimetype ?? '',
    });
  }

  /** PATCH /api/v1/tournaments/:id */
  @Patch('tournaments/:id')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update tournament (org admin+)' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  async updateTournament(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTournamentDto,
    @Req() req: FastifyRequest,
  ) {
    const userId = await getUserId(req, this.supabase);
    return this.events.updateTournament(id, dto, userId);
  }

  /**
   * POST /api/v1/tournaments/:id/customise-format
   *
   * "Customise this format": fork the built-in ruleset this tournament uses into
   * a private, org-owned coded ruleset and re-point the tournament to it. Score-
   * preserving — it only changes ownership so the locked controls unlock.
   */
  @Post('tournaments/:id/customise-format')
  @HttpCode(HttpStatus.CREATED)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Fork the built-in ruleset into a private org copy (org admin+)' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  async customiseTournamentFormat(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: FastifyRequest,
  ) {
    const userId = await getUserId(req, this.supabase);
    return this.events.forkCodedRulesetForTournament(id, userId);
  }

  /** DELETE /api/v1/tournaments/:id */
  @Delete('tournaments/:id')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Hard delete tournament (org admin+)' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  async deleteTournament(@Param('id', ParseUUIDPipe) id: string, @Req() req: FastifyRequest) {
    const userId = await getUserId(req, this.supabase);
    return this.events.deleteTournament(id, userId);
  }

  /** POST /api/v1/tournaments/:id/publish */
  @Post('tournaments/:id/publish')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Publish tournament (org admin+)' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  async publishTournament(@Param('id', ParseUUIDPipe) id: string, @Req() req: FastifyRequest) {
    const userId = await getUserId(req, this.supabase);
    return this.events.publishTournament(id, userId);
  }

  /** POST /api/v1/tournaments/:id/unpublish */
  @Post('tournaments/:id/unpublish')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Unpublish tournament back to draft (org admin+)' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  async unpublishTournament(@Param('id', ParseUUIDPipe) id: string, @Req() req: FastifyRequest) {
    const userId = await getUserId(req, this.supabase);
    return this.events.unpublishTournament(id, userId);
  }

  // `GET tournaments/:id/scoring-config` was removed — stale since the settings
  // page rename (only reference was a next.config redirect); the scoring app
  // reads `tournaments/:id/match-config` below.

  /** GET /api/v1/tournaments/:id/match-config — effective match and display config */
  @Get('tournaments/:id/match-config')
  @ApiOperation({ summary: 'Get tournament match format and display configuration' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  async getMatchConfig(@Param('id', ParseUUIDPipe) id: string) {
    const { data } = await this.supabase.service
      .from('tournaments')
      .select('ruleset_code, ruleset_config, scoring_config_json, lock_config_json')
      .eq('id', id)
      .maybeSingle();

    const { DEFAULT_SCORING_CONFIG } = await import('@myclash/types');
    const {
      normalizeTournamentLockConfig,
      normalizeTournamentScoringConfig,
      validateTournamentRulesetConfig,
    } = await import('./tournament-config.js');
    const row = data as {
      ruleset_code?: string;
      ruleset_config?: unknown;
      scoring_config_json?: unknown;
      lock_config_json?: unknown;
    } | null;
    const rulesetConfig = validateTournamentRulesetConfig(
      row?.ruleset_code ?? 'TF_v1',
      row?.ruleset_config ?? {},
    );
    const scoringConfig = normalizeTournamentScoringConfig(
      row?.scoring_config_json ?? DEFAULT_SCORING_CONFIG,
    );

    return {
      rulesetConfig,
      matchFormat: rulesetConfig.matchFormat,
      scoringConfig,
      display: scoringConfig.display,
      lockConfig: normalizeTournamentLockConfig(row?.lock_config_json),
    };
  }
}
