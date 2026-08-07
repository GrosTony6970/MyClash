import {
  Body,
  Controller,
  DefaultValuePipe,
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
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { FastifyRequest } from 'fastify';
import { ADMIN_READ_THROTTLE } from '../../common/throttling/throttle-profiles';
import { AdminUsersService, type DeletePlatformUserMode } from './admin-users.service';
import {
  AddOrgMembershipDto,
  CreatePlatformUserDto,
  ListPlatformUsersQueryDto,
  UpdateOrgMembershipRoleDto,
  UpdatePlatformUserDto,
} from './dto/admin-users.dto';
import {
  GetPlatformUserResponseDto,
  ListPlatformUsersResponseDto,
} from './dto/admin-users-response.dto';
import { PlatformRoleGuard } from './guards/platform-role.guard';
import { PlatformRole } from './guards/platform-role.decorator';
import { getActorId } from '../../common/auth/actor';

@ApiTags('super-admin')
@ApiBearerAuth()
@UseGuards(PlatformRoleGuard)
@Controller('admin/users')
export class UsersAdminController {
  constructor(private readonly service: AdminUsersService) {}

  @Get()
  @Throttle(ADMIN_READ_THROTTLE)
  @ApiOperation({ summary: 'List platform accounts in one scope (platform staff)' })
  @ApiOkResponse({ type: ListPlatformUsersResponseDto })
  async list(@Query() query: ListPlatformUsersQueryDto) {
    // A validated DTO rather than loose @Query pipes: `scope` used to fall
    // back silently to a default when it was misspelled, so a typo in a link
    // quietly listed the wrong population instead of failing.
    return this.service.listUsers(query);
  }

  @Post()
  @ApiOperation({ summary: 'Create user (super admin)' })
  async create(@Body() body: CreatePlatformUserDto, @Req() req: FastifyRequest) {
    return this.service.createPlatformUser(body, getActorId(req));
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get user with org memberships (platform staff)' })
  @ApiOkResponse({ type: GetPlatformUserResponseDto })
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
  @PlatformRole('platform_admin')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Disable user (super admin)' })
  async disable(@Param('id', ParseUUIDPipe) id: string, @Req() req: FastifyRequest) {
    await this.service.disableUser(id, getActorId(req));
  }

  @Patch(':id/enable')
  @PlatformRole('platform_admin')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Enable user (super admin)' })
  async enable(@Param('id', ParseUUIDPipe) id: string, @Req() req: FastifyRequest) {
    await this.service.enableUser(id, getActorId(req));
  }

  @Get(':id/temp-password')
  @PlatformRole('super_admin')
  @ApiOperation({
    summary: 'Reveal the temp password set at user-create (super admin)',
    description:
      'Returns the temp password if it is still in effect. Locks (and wipes) automatically once the user has changed it, or when the lock endpoint is invoked. Every reveal is audit-logged.',
  })
  async revealTempPassword(@Param('id', ParseUUIDPipe) id: string, @Req() req: FastifyRequest) {
    return this.service.revealTempPassword(id, getActorId(req));
  }

  @Delete(':id/temp-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Lock the temp password — super admin manual lock' })
  async lockTempPassword(@Param('id', ParseUUIDPipe) id: string, @Req() req: FastifyRequest) {
    return this.service.lockTempPassword(id, getActorId(req));
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
  // (`GET super-admins` was removed — no UI consumed the listing.)

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
