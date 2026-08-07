import { Public } from '../../common/auth/public.decorator';
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
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { FastifyRequest } from 'fastify';
import {
  ADMIN_READ_THROTTLE,
  CATALOG_READ_THROTTLE,
} from '../../common/throttling/throttle-profiles';
import { PlatformRoleGuard } from '../admin/guards/platform-role.guard';
import { PlatformRole } from '../admin/guards/platform-role.decorator';
import { SupabaseService } from '../supabase/supabase.service';
import { FightersService, type FighterPhotoUpload } from './fighters.service';
import { FighterMergeService } from './merge.service';
import {
  CreateFighterDto,
  CreateGlobalPersonDto,
  FighterQueryDto,
  GlobalPersonQueryDto,
  ImportCommitDto,
  LinkEnrollmentDto,
  LinkQualificationDto,
  MergeFightersDto,
  PromoteFighterDto,
  UpdateMyFighterProfileDto,
  UpdateFighterDto,
  UpdateGlobalPersonDto,
} from './dto/fighters.dto';
import { getActorId } from '../../common/auth/actor';

/** Extract claimed user ID from Supabase JWT in request. */
async function getClaimedUserId(req: FastifyRequest, supabase: SupabaseService): Promise<string> {
  const authHeader = req.headers['authorization'];
  const cookies = (req as FastifyRequest & { cookies?: Record<string, string> }).cookies;
  const token = authHeader?.startsWith('Bearer ')
    ? authHeader.slice(7)
    : cookies?.['sb-access-token'];

  if (!token) throw new UnauthorizedException('Authentication required');

  const user = await supabase.getAuthUser(token);
  if (!user) throw new UnauthorizedException('Invalid token');
  return user.id;
}

@ApiTags('fighters')
@Controller('fighters')
export class FightersController {
  constructor(
    private readonly fighters: FightersService,
    private readonly fighterMerge: FighterMergeService,
    private readonly supabase: SupabaseService,
  ) {}

  /** GET /api/v1/fighters?q=...&club=... */
  @Get()
  @ApiOperation({ summary: 'List fighters (public)' })
  async list(@Query() query: FighterQueryDto) {
    return this.fighters.list(query);
  }

  /** GET /api/v1/fighters/me/profile */
  @Get('me/profile')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get the claimed user Fighter profile' })
  async myProfile(@Req() req: FastifyRequest) {
    const userId = await getClaimedUserId(req, this.supabase);
    return this.fighters.getMyProfile(userId);
  }

  /** PATCH /api/v1/fighters/me/profile */
  @Patch('me/profile')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update the claimed user Fighter profile' })
  async updateMyProfile(@Body() dto: UpdateMyFighterProfileDto, @Req() req: FastifyRequest) {
    const userId = await getClaimedUserId(req, this.supabase);
    return this.fighters.updateMyProfile(userId, dto);
  }

  /** POST /api/v1/fighters/me/photo — upload the claimed user's profile photo. */
  @Post('me/photo')
  @HttpCode(HttpStatus.CREATED)
  @ApiBearerAuth()
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } },
  })
  @ApiOperation({ summary: 'Upload the claimed user Fighter profile photo' })
  async uploadMyPhoto(@Req() req: FastifyRequest) {
    const userId = await getClaimedUserId(req, this.supabase);
    const data = await (
      req as FastifyRequest & {
        file: () => Promise<
          { filename: string; mimetype: string; toBuffer: () => Promise<Buffer> } | undefined
        >;
      }
    ).file();
    const buffer = data ? await data.toBuffer() : Buffer.alloc(0);
    const file: FighterPhotoUpload = {
      buffer,
      filename: data?.filename ?? '',
      mimetype: data?.mimetype ?? '',
    };
    return this.fighters.uploadMyPhoto(userId, file);
  }

  /** DELETE /api/v1/fighters/me/photo — clear the claimed user's profile photo. */
  @Delete('me/photo')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Remove the claimed user Fighter profile photo' })
  async removeMyPhoto(@Req() req: FastifyRequest) {
    const userId = await getClaimedUserId(req, this.supabase);
    return this.fighters.removeMyPhoto(userId);
  }

  /** GET /api/v1/fighters/me/dashboard */
  @Get('me/dashboard')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get the claimed user Fighter dashboard' })
  async myDashboard(@Req() req: FastifyRequest) {
    const userId = await getClaimedUserId(req, this.supabase);
    return this.fighters.getMyDashboard(userId);
  }

  /** GET /api/v1/fighters/me/referee-stats */
  @Get('me/referee-stats')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get the claimed user referee statistics' })
  async myRefereeStats(@Req() req: FastifyRequest) {
    const userId = await getClaimedUserId(req, this.supabase);
    return this.fighters.getMyRefereeStats(userId);
  }

  @Get('merge/audit-log')
  @Throttle(ADMIN_READ_THROTTLE)
  @ApiBearerAuth()
  @UseGuards(PlatformRoleGuard)
  @ApiOperation({ summary: 'List recent fighter merge audit entries (super admin)' })
  async mergeAuditLog() {
    return this.fighterMerge.listMergeAudits();
  }

  /** GET /api/v1/fighters/:slug/matches?limit=20&offset=0&eventId=&year= */
  @Public()
  @Get(':slug/matches')
  @ApiOperation({ summary: 'Get paginated match history for a fighter (public)' })
  async listMatches(
    @Param('slug') slug: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
    @Query('eventId') eventId?: string,
    @Query('year') year?: string,
  ) {
    const parsedLimit = Math.min(Math.max(1, Number(limit) || 20), 100);
    const parsedOffset = Math.max(0, Number(offset) || 0);
    return this.fighters.listMatchesPaginated(slug, {
      limit: parsedLimit,
      offset: parsedOffset,
      eventId: eventId || undefined,
      year: year ? Number(year) : undefined,
    });
  }

  /** GET /api/v1/fighters/:slug */
  @Public()
  @Get(':slug/career')
  @ApiOperation({ summary: 'Get public Fighter career history and statistics' })
  async career(@Param('slug') slug: string, @Query() query: { year?: string; weapon?: string }) {
    return this.fighters.getCareerBySlug(slug, query);
  }

  /** GET /api/v1/fighters/:slug/referee-stats */
  @Public()
  @Get(':slug/referee-stats')
  @ApiOperation({ summary: 'Get public Fighter referee statistics' })
  async refereeStats(@Param('slug') slug: string) {
    return this.fighters.getRefereeStatsBySlug(slug);
  }

  /** GET /api/v1/fighters/:slug/rating-history */
  @Public()
  @Get(':slug/rating-history')
  @ApiOperation({ summary: 'Get public Fighter HEMA rating history (time-series)' })
  async ratingHistory(@Param('slug') slug: string) {
    return this.fighters.getRatingHistoryBySlug(slug);
  }

  /** GET /api/v1/fighters/:slug */
  @Public()
  @Get(':slug')
  @ApiOperation({ summary: 'Get fighter by slug (public)' })
  async getBySlug(@Param('slug') slug: string) {
    return this.fighters.getBySlug(slug);
  }

  /** POST /api/v1/fighters */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a fighter (organizer+)' })
  async create(@Body() dto: CreateFighterDto) {
    return this.fighters.create(dto);
  }

  /** PATCH /api/v1/fighters/:id */
  @Patch(':id')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update a fighter (organizer+ or claimed owner)' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateFighterDto,
    @Req() req: FastifyRequest,
  ) {
    const userId = await getClaimedUserId(req, this.supabase);
    return this.fighters.updateAsClaimedUser(id, dto, userId);
  }

  /**
   * POST /api/v1/fighters/:id/promote
   * Promotes a Person to a global Fighter profile.
   * Requires a claimed account whose persons.id matches the Person.
   */
  @Post(':id/promote')
  @HttpCode(HttpStatus.CREATED)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Promote a Person to global Fighter (claimed user only)' })
  async promote(@Body() dto: PromoteFighterDto, @Req() req: FastifyRequest) {
    const userId = await getClaimedUserId(req, this.supabase);
    return this.fighters.promote(dto, userId);
  }

  /**
   * POST /api/v1/fighters/merge
   * Merge two fighter profiles (super admin only).
   */
  @Post('merge')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @UseGuards(PlatformRoleGuard)
  @PlatformRole('platform_admin')
  @ApiOperation({ summary: 'Merge two fighter profiles (super admin)' })
  async merge(@Body() dto: MergeFightersDto, @Req() req: FastifyRequest) {
    const actorUserId = getActorId(req);
    return this.fighterMerge.merge(dto, actorUserId);
  }

  @Post('merge/:auditLogId/revert')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth()
  @UseGuards(PlatformRoleGuard)
  @PlatformRole('platform_admin')
  @ApiOperation({ summary: 'Revert a fighter merge within 30 days (super admin)' })
  async revertMerge(
    @Param('auditLogId', ParseUUIDPipe) auditLogId: string,
    @Req() req: FastifyRequest,
  ) {
    const actorUserId = getActorId(req);
    await this.fighterMerge.revertMerge(auditLogId, actorUserId);
  }
}

@ApiTags('weapons')
@Controller('weapons')
export class WeaponsController {
  constructor(private readonly fighters: FightersService) {}

  @Get()
  @ApiOperation({ summary: 'List controlled weapon catalog entries' })
  @ApiQuery({
    name: 'active',
    required: false,
    description: 'When "true", only return active catalog entries (for pickers).',
  })
  async list(@Query('active') active?: string) {
    return this.fighters.listWeapons(active === 'true');
  }
}

@ApiTags('global-persons')
@Controller('global-persons')
export class GlobalPersonsController {
  constructor(
    private readonly fighters: FightersService,
    private readonly supabase: SupabaseService,
  ) {}

  /** GET /api/v1/global-persons?q=...&roles=referee */
  @Get()
  @Throttle(CATALOG_READ_THROTTLE)
  @ApiOperation({ summary: 'List global persons (public)' })
  async list(@Query() query: GlobalPersonQueryDto) {
    return this.fighters.listGlobalPersons(query);
  }

  /** POST /api/v1/global-persons */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create an unclaimed global person (organizer+)' })
  async create(@Body() dto: CreateGlobalPersonDto) {
    return this.fighters.createGlobalPerson(dto);
  }

  /** PATCH /api/v1/global-persons/:id */
  @Patch(':id')
  @ApiBearerAuth()
  @UseGuards(PlatformRoleGuard)
  @PlatformRole('platform_admin')
  @ApiOperation({ summary: 'Update a global person profile (super admin)' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  async update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateGlobalPersonDto) {
    return this.fighters.updateGlobalPerson(id, dto);
  }

  /**
   * POST /api/v1/global-persons/import/preview
   * Parses the CSV and returns per-row status + duplicate matches + reasons,
   * without writing anything. The admin then sends a JSON decisions array to
   * POST /api/v1/global-persons/import to commit.
   */
  @Post('import/preview')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @UseGuards(PlatformRoleGuard)
  @PlatformRole('platform_admin')
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @ApiOperation({ summary: 'Dry-run a Global Profiles CSV import (super admin)' })
  async previewGlobalPersonsImport(@Req() req: FastifyRequest) {
    let buffer: Buffer | null = null;
    try {
      const data = await (
        req as FastifyRequest & {
          file: () => Promise<{ toBuffer: () => Promise<Buffer> } | null>;
        }
      ).file();
      if (data) buffer = await data.toBuffer();
    } catch {
      // no file
    }

    if (!buffer) {
      return {
        summary: { total: 0, ok: 0, invalid: 0, duplicate: 0 },
        rows: [],
      };
    }
    return this.fighters.previewGlobalPersonsImport(buffer);
  }

  /**
   * POST /api/v1/global-persons/import
   * Commits the user's per-row decisions from the preview step. Each
   * decision is { index, action, fields, optional targetGlobalPersonId }.
   */
  @Post('import')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @UseGuards(PlatformRoleGuard)
  @PlatformRole('platform_admin')
  @ApiOperation({ summary: 'Commit a Global Profiles CSV import (super admin)' })
  async commitGlobalPersonsImport(@Body() dto: ImportCommitDto) {
    return this.fighters.commitGlobalPersonsImport(dto.decisions);
  }

  // (`PATCH :id/roles` and `GET/PATCH :id/referee-profile` were removed — a
  // half-shipped referee-profile editor with zero consumers; role edits flow
  // through the generic `PATCH global-persons/:id` body instead.)

  /** PATCH /api/v1/global-persons/:id/link-referee-qualification */
  @Patch(':id/link-referee-qualification')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Link a referee qualification to a global person (organizer+)' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  async linkRefereeQualification(
    @Param('id', ParseUUIDPipe) globalPersonId: string,
    @Body() dto: LinkQualificationDto,
  ) {
    await this.fighters.linkRefereeQualification(dto.qualificationId, globalPersonId);
    return { linked: true };
  }

  /** PATCH /api/v1/global-persons/:id/link-workshop-enrollment */
  @Patch(':id/link-workshop-enrollment')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Link a workshop enrollment to a global person (organizer+)' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  async linkWorkshopEnrollment(
    @Param('id', ParseUUIDPipe) globalPersonId: string,
    @Body() dto: LinkEnrollmentDto,
  ) {
    await this.fighters.linkWorkshopEnrollment(dto.enrollmentId, globalPersonId);
    return { linked: true };
  }
}
