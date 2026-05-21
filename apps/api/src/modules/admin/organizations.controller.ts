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
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { AdminOrganizationsService } from './admin-organizations.service';
import {
  CreateOrganizationDto,
  ListOrgsQueryDto,
  PromoteSuperAdminDto,
  ReassignOwnerDto,
  UpdateOrganizationDto,
} from './dto/admin-organizations.dto';
import { SuperAdminGuard } from './guards/super-admin.guard';

/** Extract the authenticated user ID from the request (set by SuperAdminGuard). */
function getActorId(req: FastifyRequest): string {
  return (req as FastifyRequest & { actorUserId?: string }).actorUserId ?? 'unknown';
}

@ApiTags('super-admin')
@ApiBearerAuth()
@UseGuards(SuperAdminGuard)
@Controller('admin/organizations')
export class OrganizationsAdminController {
  constructor(private readonly service: AdminOrganizationsService) {}

  /**
   * GET /api/v1/admin/organizations
   * List all organizations. Sortable and filterable.
   */
  @Get()
  @ApiOperation({ summary: 'List all organizations (super admin)' })
  @ApiResponse({ status: 200, description: 'Organization list' })
  async list(@Query() query: ListOrgsQueryDto) {
    return this.service.listOrganizations(query);
  }

  /**
   * POST /api/v1/admin/organizations
   * Create an organization and assign an owner organizer account.
   */
  @Post()
  @ApiOperation({ summary: 'Create organization with owner organizer (super admin)' })
  @ApiResponse({ status: 201, description: 'Organization created' })
  async create(@Body() dto: CreateOrganizationDto, @Req() req: FastifyRequest) {
    return this.service.createOrganizationWithOwner(dto, getActorId(req));
  }

  /**
   * GET /api/v1/admin/organizations/:id
   * Organization detail with members and recent audit log.
   */
  @Get(':id')
  @ApiOperation({ summary: 'Get organization detail (super admin)' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  async detail(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.getOrganization(id);
  }

  /**
   * PATCH /api/v1/admin/organizations/:id
   * Update organization basics (name, slug).
   */
  @Patch(':id')
  @ApiOperation({ summary: 'Update organization basics (super admin)' })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateOrganizationDto,
    @Req() req: FastifyRequest,
  ) {
    return this.service.updateOrganization(id, dto, getActorId(req));
  }

  /**
   * PATCH /api/v1/admin/organizations/:id/suspend
   * Suspend an organization. All events become read-only-public.
   */
  @Patch(':id/suspend')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Suspend organization (super admin)' })
  async suspend(@Param('id', ParseUUIDPipe) id: string, @Req() req: FastifyRequest) {
    await this.service.suspendOrganization(id, getActorId(req));
  }

  /**
   * PATCH /api/v1/admin/organizations/:id/reactivate
   * Reactivate a suspended organization.
   */
  @Patch(':id/reactivate')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Reactivate organization (super admin)' })
  async reactivate(@Param('id', ParseUUIDPipe) id: string, @Req() req: FastifyRequest) {
    await this.service.reactivateOrganization(id, getActorId(req));
  }

  /**
   * PATCH /api/v1/admin/organizations/:id/approve
   * Explicit BUILD_ORDER T-1301 approval alias for reactivating organizers.
   */
  @Patch(':id/approve')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Approve/reactivate organization (super admin)' })
  async approve(@Param('id', ParseUUIDPipe) id: string, @Req() req: FastifyRequest) {
    await this.service.approveOrganization(id, getActorId(req));
  }

  /**
   * DELETE /api/v1/admin/organizations/:id
   * Hard delete. Cascades to events; preserves global Fighter profiles.
   */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Hard delete organization (super admin)' })
  async delete(@Param('id', ParseUUIDPipe) id: string, @Req() req: FastifyRequest) {
    await this.service.deleteOrganization(id, getActorId(req));
  }

  /**
   * POST /api/v1/admin/organizations/:id/reassign-owner
   *
   * Assigns or reassigns ownership. Accepts an existing user (`ownerUserId`)
   * or a new account by email (`ownerEmail` + `ownerDisplayName`). Works
   * uniformly whether the org has a current owner or not — when there is
   * none, this becomes the first-time assignment.
   */
  @Post(':id/reassign-owner')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Assign or reassign organization owner (super admin)' })
  async reassignOwner(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReassignOwnerDto,
    @Req() req: FastifyRequest,
  ) {
    return this.service.reassignOwner(id, dto, getActorId(req));
  }

  /**
   * POST /api/v1/admin/users/promote-super-admin
   * Promote a user to super_admin platform role.
   */
  @Post('../users/promote-super-admin')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Promote user to super_admin (super admin)' })
  async promoteSuperAdmin(@Body() dto: PromoteSuperAdminDto, @Req() req: FastifyRequest) {
    await this.service.promoteSuperAdmin(dto, getActorId(req));
  }
}
