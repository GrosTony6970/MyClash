import {
  Body,
  Controller,
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
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { SuperAdminGuard } from '../admin/guards/super-admin.guard';
import { SupabaseService } from '../supabase/supabase.service';
import { FightersService } from './fighters.service';
import { FighterMergeService } from './merge.service';
import {
  CreateFighterDto,
  FighterQueryDto,
  MergeFightersDto,
  PromoteFighterDto,
  UpdateMyFighterProfileDto,
  UpdateFighterDto,
} from './dto/fighters.dto';

/** Extract claimed user ID from Supabase JWT in request. */
async function getClaimedUserId(req: FastifyRequest, supabase: SupabaseService): Promise<string> {
  const authHeader = req.headers['authorization'];
  const cookies = (req as FastifyRequest & { cookies?: Record<string, string> }).cookies;
  const token = authHeader?.startsWith('Bearer ')
    ? authHeader.slice(7)
    : cookies?.['sb-access-token'];

  if (!token) throw new UnauthorizedException('Authentication required');

  const {
    data: { user },
    error,
  } = await supabase.anon.auth.getUser(token);
  if (error || !user) throw new UnauthorizedException('Invalid token');
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
  @ApiBearerAuth()
  @UseGuards(SuperAdminGuard)
  @ApiOperation({ summary: 'List recent fighter merge audit entries (super admin)' })
  async mergeAuditLog() {
    return this.fighterMerge.listMergeAudits();
  }

  /** GET /api/v1/fighters/:slug */
  @Get(':slug/career')
  @ApiOperation({ summary: 'Get public Fighter career history and statistics' })
  async career(@Param('slug') slug: string, @Query() query: { year?: string; weapon?: string }) {
    return this.fighters.getCareerBySlug(slug, query);
  }

  /** GET /api/v1/fighters/:slug/referee-stats */
  @Get(':slug/referee-stats')
  @ApiOperation({ summary: 'Get public Fighter referee statistics' })
  async refereeStats(@Param('slug') slug: string) {
    return this.fighters.getRefereeStatsBySlug(slug);
  }

  /** GET /api/v1/fighters/:slug */
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
  @UseGuards(SuperAdminGuard)
  @ApiOperation({ summary: 'Merge two fighter profiles (super admin)' })
  async merge(@Body() dto: MergeFightersDto, @Req() req: FastifyRequest) {
    const actorUserId = (req as FastifyRequest & { actorUserId?: string }).actorUserId ?? 'unknown';
    return this.fighterMerge.merge(dto, actorUserId);
  }

  @Post('merge/:auditLogId/revert')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth()
  @UseGuards(SuperAdminGuard)
  @ApiOperation({ summary: 'Revert a fighter merge within 30 days (super admin)' })
  async revertMerge(
    @Param('auditLogId', ParseUUIDPipe) auditLogId: string,
    @Req() req: FastifyRequest,
  ) {
    const actorUserId = (req as FastifyRequest & { actorUserId?: string }).actorUserId ?? 'unknown';
    await this.fighterMerge.revertMerge(auditLogId, actorUserId);
  }
}

@ApiTags('weapons')
@Controller('weapons')
export class WeaponsController {
  constructor(private readonly fighters: FightersService) {}

  @Get()
  @ApiOperation({ summary: 'List controlled weapon catalog entries' })
  async list() {
    return this.fighters.listWeapons();
  }
}
