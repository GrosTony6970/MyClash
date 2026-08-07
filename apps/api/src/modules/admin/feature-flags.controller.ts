import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { AdminFeatureFlagsService } from './admin-feature-flags.service';
import { UpsertFeatureFlagDto } from './dto/admin-feature-flags.dto';
import { PlatformRoleGuard } from './guards/platform-role.guard';
import { PlatformRole } from './guards/platform-role.decorator';
import { getActorId } from '../../common/auth/actor';

@ApiTags('super-admin')
@ApiBearerAuth()
@UseGuards(PlatformRoleGuard)
@PlatformRole('super_admin')
@Controller('admin/feature-flags')
export class FeatureFlagsAdminController {
  constructor(private readonly service: AdminFeatureFlagsService) {}

  @Get()
  @ApiOperation({ summary: 'List feature flags merged with registry (super admin)' })
  async list() {
    return this.service.listFlagsWithRegistry();
  }

  @Put(':key')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Upsert feature flag (super admin)' })
  async upsert(
    @Param('key') key: string,
    @Body() dto: UpsertFeatureFlagDto,
    @Req() req: FastifyRequest,
  ) {
    await this.service.upsertFlag(key, dto, getActorId(req));
  }
}
