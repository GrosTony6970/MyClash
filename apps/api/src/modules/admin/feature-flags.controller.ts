import {
  Body,
  Controller,
  Delete,
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
import { SuperAdminGuard } from './guards/super-admin.guard';

function getActorId(req: FastifyRequest): string {
  return (req as FastifyRequest & { actorUserId?: string }).actorUserId ?? 'unknown';
}

@ApiTags('super-admin')
@ApiBearerAuth()
@UseGuards(SuperAdminGuard)
@Controller('admin/feature-flags')
export class FeatureFlagsAdminController {
  constructor(private readonly service: AdminFeatureFlagsService) {}

  @Get()
  @ApiOperation({ summary: 'List feature flags (super admin)' })
  async list() {
    return this.service.listFlags();
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

  @Delete(':key')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete feature flag (super admin)' })
  async delete(@Param('key') key: string, @Req() req: FastifyRequest) {
    await this.service.deleteFlag(key, getActorId(req));
  }
}
