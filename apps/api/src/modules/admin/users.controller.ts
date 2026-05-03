import {
  Controller,
  DefaultValuePipe,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Patch,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { AdminUsersService } from './admin-users.service';
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
}
