import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { ADMIN_READ_THROTTLE } from '../../common/throttling/throttle-profiles';
import { AdminBackupsService } from '../admin/backups.service';
import type { HostInfoResponseDto } from '../admin/dto/host-info.dto';
import type { RuntimeHealthResponseDto } from '../admin/dto/runtime-health.dto';
import type { TlsStatusResponseDto } from '../admin/dto/tls-status.dto';
import { AdminHostInfoService } from '../admin/host-info.service';
import { AdminRuntimeHealthService } from '../admin/runtime-health.service';
import { AdminSystemVersionsService } from '../admin/system-versions.service';
import { AdminTlsStatusService } from '../admin/tls-status.service';
import { AgentDoor } from './agent-door.decorator';
import {
  maskBackups,
  maskVersions,
  type AgentBackupStatusDto,
  type AgentVersionsDto,
} from './mask';

/**
 * The ops agent's door: five reads of the platform's health (the ops agent's design, section 2).
 * Only the agent key opens it (`AgentDoor`). Alert settings are not here: they list the email
 * addresses of the people who receive alerts.
 */
@ApiTags('ops-agent')
@Controller('ops-agent')
@AgentDoor()
@Throttle(ADMIN_READ_THROTTLE)
export class OpsAgentController {
  constructor(
    private readonly runtime: AdminRuntimeHealthService,
    private readonly hostInfo: AdminHostInfoService,
    private readonly systemVersions: AdminSystemVersionsService,
    private readonly backupsService: AdminBackupsService,
    private readonly tlsStatus: AdminTlsStatusService,
  ) {}

  @Get('runtime-health')
  @ApiOperation({
    summary: 'Runtime health of the database, Redis, queues, disk and photo storage',
  })
  runtimeHealth(): Promise<RuntimeHealthResponseDto> {
    return this.runtime.collect();
  }

  @Get('host')
  @ApiOperation({ summary: 'Host facts: OS, kernel, Docker, CPU, memory and disk' })
  host(): Promise<HostInfoResponseDto> {
    return this.hostInfo.collect();
  }

  @Get('versions')
  @ApiOperation({ summary: 'Component versions and the last deploy, without who deployed' })
  async versions(): Promise<AgentVersionsDto> {
    return maskVersions(await this.systemVersions.getSystemVersions());
  }

  @Get('backups')
  @ApiOperation({ summary: 'Backup state, without shell output or error text' })
  async backups(): Promise<AgentBackupStatusDto> {
    return maskBackups(await this.backupsService.getStatus());
  }

  @Get('tls')
  @ApiOperation({ summary: 'Certificate state of every public host' })
  tls(): Promise<TlsStatusResponseDto> {
    return this.tlsStatus.probeAll();
  }
}
