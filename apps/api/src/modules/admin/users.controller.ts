import {
  Body,
  Controller,
  DefaultValuePipe,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { FastifyRequest } from 'fastify';
import { ADMIN_READ_THROTTLE } from '../../common/throttling/throttle-profiles';
import { AdminUsersService, type DeletePlatformUserMode } from './admin-users.service';
import {
  AddOrgMembershipDto,
  CreatePlatformUserDto,
  UpdateOrgMembershipRoleDto,
  UpdatePlatformUserDto,
} from './dto/admin-users.dto';
import { SuperAdminGuard } from './guards/super-admin.guard';

function getActorId(req: FastifyRequest): string {
  return (req as FastifyRequest & { actorUserId?: string }).actorUserId ?? 'unknown';
}

@ApiTags('super-admin')
@ApiBearerAuth()
@UseGuards(SuperAdminGuard)
@Controller('admin/users')
export class UsersAdminController {
  constructor(private readonly service: AdminUsersService) {}

  @Get()
  @Throttle(ADMIN_READ_THROTTLE)
  @ApiOperation({ summary: 'List users (super admin)' })
  async list(
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('perPage', new DefaultValuePipe(50), ParseIntPipe) perPage: number,
    @Query('q') q?: string,
  ) {
    return this.service.listUsers({ page, perPage, q });
  }

  @Post()
  @ApiOperation({ summary: 'Create user (super admin)' })
  async create(@Body() body: CreatePlatformUserDto, @Req() req: FastifyRequest) {
    return this.service.createPlatformUser(body, getActorId(req));
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get user with org memberships (super admin)' })
  async getOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.getUser(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update user email or display name (super admin)' })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdatePlatformUserDto,
    @Req() req: FastifyRequest,
  ) {
    return this.service.updateUser(id, body, getActorId(req));
  }

  @Post(':id/organizations')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Add user to an organization (super admin)' })
  async addOrgMembership(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: AddOrgMembershipDto,
    @Req() req: FastifyRequest,
  ) {
    return this.service.addOrgMembership(id, body.organizationId, body.role, getActorId(req));
  }

  @Patch(':id/organizations/:orgId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Update a user's role within an organization (super admin)" })
  async updateOrgMembership(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Body() body: UpdateOrgMembershipRoleDto,
    @Req() req: FastifyRequest,
  ) {
    return this.service.updateOrgMembershipRole(id, orgId, body.role, getActorId(req));
  }

  @Delete(':id/organizations/:orgId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Remove a user from an organization (super admin)' })
  async removeOrgMembership(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Req() req: FastifyRequest,
  ) {
    return this.service.removeOrgMembership(id, orgId, getActorId(req));
  }

  @Patch(':id/disable')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Disable user (super admin)' })
  async disable(@Param('id', ParseUUIDPipe) id: string, @Req() req: FastifyRequest) {
    await this.service.disableUser(id, getActorId(req));
  }

  @Patch(':id/enable')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Enable user (super admin)' })
  async enable(@Param('id', ParseUUIDPipe) id: string, @Req() req: FastifyRequest) {
    await this.service.enableUser(id, getActorId(req));
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete user (super admin)' })
  async deletePlatformUser(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('mode', new DefaultValuePipe('safe')) mode: DeletePlatformUserMode,
    @Req() req: FastifyRequest,
  ) {
    return this.service.deletePlatformUser(
      id,
      getActorId(req),
      mode === 'cleanup' ? 'cleanup' : 'safe',
    );
  }

  // ── Super admin role management ───────────────────────────────────────────

  @Get('super-admins')
  @ApiOperation({ summary: 'List all super admins (super admin)' })
  async listSuperAdmins() {
    return this.service.listSuperAdmins();
  }

  @Post(':id/promote-super-admin')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Promote user to super admin (super admin)' })
  async promoteSuperAdmin(@Param('id', ParseUUIDPipe) id: string, @Req() req: FastifyRequest) {
    await this.service.promoteSuperAdmin(id, getActorId(req));
  }

  @Delete(':id/super-admin')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Revoke super admin role from user (super admin)' })
  async revokeSuperAdmin(@Param('id', ParseUUIDPipe) id: string, @Req() req: FastifyRequest) {
    await this.service.revokeSuperAdmin(id, getActorId(req));
  }
}
