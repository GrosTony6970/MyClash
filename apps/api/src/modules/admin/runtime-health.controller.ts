// runtime-health.controller.ts
import { Body, Controller, Get, Put, Req, UseGuards } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import type {
  RuntimeHealthResponseDto,
  RuntimeHealthAlertSettings,
} from './dto/runtime-health.dto';
import { UpdateAlertSettingsDto } from './dto/runtime-health.dto';
import { SuperAdminGuard } from './guards/super-admin.guard';
import { AdminRuntimeHealthService } from './runtime-health.service';
import { RuntimeHealthAlertSettingsService } from './runtime-health-alert-settings.service';
import { getActorId } from '../../common/auth/actor';

@ApiTags('admin')
@ApiCookieAuth('sb-access-token')
@UseGuards(SuperAdminGuard)
@Controller('admin/system/runtime-health')
export class RuntimeHealthAdminController {
  constructor(
    private readonly runtimeHealth: AdminRuntimeHealthService,
    private readonly settings: RuntimeHealthAlertSettingsService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Aggregated runtime health (DB, Redis, queues, disk)' })
  getRuntimeHealth(): Promise<RuntimeHealthResponseDto> {
    return this.runtimeHealth.collect();
  }

  @Get('alert-settings')
  @ApiOperation({ summary: 'Get runtime-health alert settings' })
  getAlertSettings(): Promise<RuntimeHealthAlertSettings> {
    return this.settings.getSettings();
  }

  @Put('alert-settings')
  @ApiOperation({ summary: 'Update runtime-health alert settings' })
  updateAlertSettings(
    @Body() dto: UpdateAlertSettingsDto,
    @Req() req: FastifyRequest,
  ): Promise<RuntimeHealthAlertSettings> {
    return this.settings.updateSettings(dto, getActorId(req));
  }
}
