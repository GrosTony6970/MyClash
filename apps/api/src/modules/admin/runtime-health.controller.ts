// runtime-health.controller.ts
import { Body, Controller, Get, Put, Query, Req, UseGuards } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import type {
  RuntimeHealthResponseDto,
  RuntimeHealthAlertSettings,
  RuntimeHealthSeriesResponseDto,
} from './dto/runtime-health.dto';
import { UpdateAlertSettingsDto } from './dto/runtime-health.dto';
import { PlatformRoleGuard } from './guards/platform-role.guard';
import { AdminRuntimeHealthService } from './runtime-health.service';
import { RuntimeHealthAlertSettingsService } from './runtime-health-alert-settings.service';
import { RuntimeHealthSamplesService } from './runtime-health-samples.service';
import { getActorId } from '../../common/auth/actor';

const DEFAULT_SERIES_HOURS = 24;

@ApiTags('admin')
@ApiCookieAuth('sb-access-token')
@UseGuards(PlatformRoleGuard)
@Controller('admin/system/runtime-health')
export class RuntimeHealthAdminController {
  constructor(
    private readonly runtimeHealth: AdminRuntimeHealthService,
    private readonly settings: RuntimeHealthAlertSettingsService,
    private readonly samples: RuntimeHealthSamplesService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Aggregated runtime health (DB, Redis, queues, disk)' })
  getRuntimeHealth(): Promise<RuntimeHealthResponseDto> {
    return this.runtimeHealth.collect();
  }

  @Get('series')
  @ApiOperation({ summary: 'Retained runtime-health samples for the trend view' })
  @ApiQuery({ name: 'hours', required: false, description: 'Window size; clamped to retention.' })
  getSeries(@Query('hours') hours?: string): Promise<RuntimeHealthSeriesResponseDto> {
    // Parsed permissively and clamped in the service rather than validated into
    // a 400: this backs a chart's range selector, and a nonsense value should
    // draw the default window, not break the card.
    const parsed = Number(hours);
    return this.samples.getSeries(Number.isFinite(parsed) ? parsed : DEFAULT_SERIES_HOURS);
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
