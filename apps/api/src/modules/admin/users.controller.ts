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
import type { FastifyRequest } from 'fastify';
import { AdminUsersService, type DeletePlatformUserMode } from './admin-users.service';
import { CreatePlatformUserDto } from './dto/admin-users.dto';
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
  @ApiOperation({ summary: 'List users (super admin)' })
  async list(
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('perPage', new DefaultValuePipe(50), ParseIntPipe) perPage: number,
  ) {
    return this.service.listUsers({ page, perPage });
  }

  @Post()
  @ApiOperation({ summary: 'Create user (super admin)' })
  async create(@Body() body: CreatePlatformUserDto, @Req() req: FastifyRequest) {
    return this.service.createPlatformUser(body, getActorId(req));
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
