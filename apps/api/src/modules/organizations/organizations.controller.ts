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
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { SuperAdminGuard } from '../admin/guards/super-admin.guard';
import { SupabaseService } from '../supabase/supabase.service';
import {
  AddMemberDto,
  CreateOrganizationDto,
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
  @UseGuards(SuperAdminGuard)
  @ApiOperation({ summary: 'List all organizations (super admin)' })
  async list() {
    return this.orgs.list();
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

  /** POST /api/v1/organizations/:id/approve — super admin only */
  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  @UseGuards(SuperAdminGuard)
  @ApiOperation({ summary: 'Approve organization (super admin)' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  async approve(@Param('id', ParseUUIDPipe) id: string) {
    return this.orgs.approve(id);
  }

  /** POST /api/v1/organizations/:id/members — owner only */
  @Post(':id/members')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Add member to organization (owner)' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  async addMember(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddMemberDto,
    @Req() req: FastifyRequest,
  ) {
    const userId = await getUserId(req, this.supabase);
    return this.orgs.addMember(id, dto, userId);
  }
}
