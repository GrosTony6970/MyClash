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
  UseGuards,
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
import { Public } from '../../common/auth/public.decorator';
import { PlatformRoleGuard } from '../admin/guards/platform-role.guard';
import { SupabaseService } from '../supabase/supabase.service';
import {
  AddMemberDto,
  CreateOrganizationDto,
  PublicOrganizationQueryDto,
  UpdateOrganizationDto,
} from './dto/organizations.dto';
import { OrganizationsService } from './organizations.service';

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

@ApiTags('organizations')
@ApiBearerAuth()
@Controller('organizations')
export class OrganizationsController {
  constructor(
    private readonly orgs: OrganizationsService,
    private readonly supabase: SupabaseService,
  ) {}

  /** GET /api/v1/organizations — super admin only */
  @Get()
  @UseGuards(PlatformRoleGuard)
  @ApiOperation({ summary: 'List all organizations (super admin)' })
  async list() {
    return this.orgs.list();
  }

  /**
   * GET /api/v1/organizations/public?q=&limit=&offset=
   *
   * Anonymous organiser directory backing /organisers. Active organisations
   * only, with the same projection as the profile endpoint below — no
   * contact_email, no status. Declared above @Get(':id') for the same
   * declaration-order reason as public/:slug.
   */
  @Public()
  @Get('public')
  @ApiOperation({ summary: 'List public organisers (anonymous, searchable)' })
  async listPublic(@Query() query: PublicOrganizationQueryDto) {
    return this.orgs.listPublic(query);
  }

  /**
   * GET /api/v1/organizations/public/:slug
   *
   * Anonymous organiser profile backing the public /o/[slug] page. Declared
   * ABOVE @Get(':id') on purpose — Nest matches routes in declaration order, so
   * a later position would let 'public' be swallowed as an :id (and rejected by
   * ParseUUIDPipe).
   */
  @Public()
  @Get('public/:slug')
  @ApiOperation({ summary: 'Public organiser profile by slug (anonymous)' })
  @ApiParam({ name: 'slug', type: 'string' })
  async getPublicBySlug(@Param('slug') slug: string) {
    return this.orgs.getPublicBySlug(slug);
  }

  /** GET /api/v1/organizations/slug/:slug */
  @Get('slug/:slug')
  @ApiOperation({ summary: 'Get organization by slug' })
  @ApiParam({ name: 'slug', type: 'string' })
  async getBySlug(@Param('slug') slug: string) {
    return this.orgs.getBySlug(slug);
  }

  /** GET /api/v1/organizations/:id/dashboard-stats */
  @Get(':id/dashboard-stats')
  @ApiOperation({ summary: 'Get organizer dashboard statistics' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  async dashboardStats(@Param('id', ParseUUIDPipe) id: string, @Req() req: FastifyRequest) {
    const userId = await getUserId(req, this.supabase);
    return this.orgs.dashboardStats(id, userId);
  }

  /** GET /api/v1/organizations/:id */
  @Get(':id')
  @ApiOperation({ summary: 'Get organization by ID' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  async getById(@Param('id', ParseUUIDPipe) id: string) {
    return this.orgs.getById(id);
  }

  /**
   * POST /api/v1/organizations
   * Creates with status='pending_approval'. Requires authenticated user.
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create organization (pending approval)' })
  async create(@Body() dto: CreateOrganizationDto, @Req() req: FastifyRequest) {
    const userId = await getUserId(req, this.supabase);
    return this.orgs.create(dto, userId);
  }

  /** PATCH /api/v1/organizations/:id — owner only */
  @Patch(':id')
  @ApiOperation({ summary: 'Update organization (owner)' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateOrganizationDto,
    @Req() req: FastifyRequest,
  ) {
    const userId = await getUserId(req, this.supabase);
    return this.orgs.update(id, dto, userId);
  }

  /** POST /api/v1/organizations/:id/logo — org admin+ */
  @Post(':id/logo')
  @HttpCode(HttpStatus.CREATED)
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } },
  })
  @ApiOperation({ summary: 'Upload organization logo (org admin+)' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  async uploadLogo(@Param('id', ParseUUIDPipe) id: string, @Req() req: FastifyRequest) {
    const userId = await getUserId(req, this.supabase);
    const data = await (
      req as FastifyRequest & {
        file: () => Promise<
          { filename: string; mimetype: string; toBuffer: () => Promise<Buffer> } | undefined
        >;
      }
    ).file();
    const buffer = data ? await data.toBuffer() : Buffer.alloc(0);
    return this.orgs.uploadLogo(id, userId, {
      buffer,
      filename: data?.filename ?? '',
      mimetype: data?.mimetype ?? '',
    });
  }

  // (`POST :id/approve` was removed — it duplicated the consumed
  // `PATCH admin/organizations/:id/approve` super-admin route.)

  /** GET /api/v1/organizations/:id/members — org admin+ */
  @Get(':id/members')
  @ApiOperation({ summary: 'List organization members with resolved names (org admin+)' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  async listMembers(@Param('id', ParseUUIDPipe) id: string, @Req() req: FastifyRequest) {
    const userId = await getUserId(req, this.supabase);
    return this.orgs.listMembers(id, userId);
  }

  /** POST /api/v1/organizations/:id/members — owner only */
  @Post(':id/members')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Add member to organization by userId or email (owner)' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  async addMember(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddMemberDto,
    @Req() req: FastifyRequest,
  ) {
    const userId = await getUserId(req, this.supabase);
    return this.orgs.addMember(id, dto, userId);
  }

  /** DELETE /api/v1/organizations/:id/members/:userId — owner only */
  @Delete(':id/members/:userId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Remove member from organization (owner; owner row protected)' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiParam({ name: 'userId', type: 'string', format: 'uuid' })
  async removeMember(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('userId', ParseUUIDPipe) targetUserId: string,
    @Req() req: FastifyRequest,
  ) {
    const userId = await getUserId(req, this.supabase);
    return this.orgs.removeMember(id, targetUserId, userId);
  }
}
