import { Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import {
  ADMIN_READ_THROTTLE,
  AGENT_ACTION_THROTTLE,
} from '../../common/throttling/throttle-profiles';
import { AdminBackupsService } from '../admin/backups.service';
import type { HostInfoResponseDto } from '../admin/dto/host-info.dto';
import type { RuntimeHealthResponseDto } from '../admin/dto/runtime-health.dto';
import type { TlsStatusResponseDto } from '../admin/dto/tls-status.dto';
import { AdminHostInfoService } from '../admin/host-info.service';
import { AdminRuntimeHealthService } from '../admin/runtime-health.service';
import { AdminSystemActionsService, componentKeyForService } from '../admin/system-actions.service';
import { AdminSystemVersionsService } from '../admin/system-versions.service';
import { AdminTlsStatusService } from '../admin/tls-status.service';
import { AgentActor } from './agent-actor.decorator';
import { AgentDoor } from './agent-door.decorator';
import { AgentEventsLiveService } from './agent-events-live.service';
import { AgentLogsService } from './agent-logs.service';
import {
  AgentContainerActionParamDto,
  type AgentActionResultDto,
  type AgentBackupStartedDto,
} from './dto/agent-actions.dto';
import type { AgentEventsLiveDto } from './dto/agent-events-live.dto';
import {
  AgentLogParamDto,
  AgentLogQueryDto,
  type AgentContainersDto,
  type AgentLogDto,
} from './dto/agent-logs.dto';
import {
  maskActionResult,
  maskBackupStarted,
  maskBackups,
  maskVersions,
  withoutErrorText,
  type AgentBackupStatusDto,
  type AgentVersionsDto,
} from './mask';

/**
 * The ops agent's door: eight reads and three actions (the ops agent's design, section 2). Only the agent key opens
 * it (`AgentDoor`). Five read the platform's health; their error texts are withheld
 * (`withoutErrorText`, ruling 870). Two read the containers: their state, and the last lines of
 * one container's log, every line scrubbed (`scrubForAgent`: no address or phone, an IP address
 * cut in half, ruling 868), and never the log of `db` or `supabase-meta` (ruling 869). Alert
 * settings are not here: they list the email addresses of the people who receive alerts. One read
 * says whether an Event is live (rulings 882, 883). The actions (slice 4) restart or start one
 * listed container, never stop it; run a backup; renew the certificates. Each writes its audit
 * row under the key's own account (`AgentActor`), and answers no shell output or error text.
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
    private readonly agentLogs: AgentLogsService,
    private readonly eventsLiveService: AgentEventsLiveService,
    private readonly systemActions: AdminSystemActionsService,
  ) {}

  @Get('runtime-health')
  @ApiOperation({
    summary: 'Runtime health of the database, Redis, queues, disk and photo storage',
  })
  async runtimeHealth(): Promise<RuntimeHealthResponseDto> {
    return withoutErrorText(await this.runtime.collect());
  }

  @Get('host')
  @ApiOperation({ summary: 'Host facts: OS, kernel, Docker, CPU, memory and disk' })
  async host(): Promise<HostInfoResponseDto> {
    return withoutErrorText(await this.hostInfo.collect());
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
  async tls(): Promise<TlsStatusResponseDto> {
    return withoutErrorText(await this.tlsStatus.probeAll());
  }

  @Get('containers')
  @ApiOperation({ summary: 'The state of every container of the stack, stopped ones included' })
  containers(): Promise<AgentContainersDto> {
    return this.agentLogs.containers();
  }

  @Get('events/live')
  @ApiOperation({
    summary: 'Whether an Event is live now (status, a bout in play, today within its dates)',
  })
  eventsLive(): Promise<AgentEventsLiveDto> {
    return this.eventsLiveService.read();
  }

  @Get('logs/:service')
  @ApiOperation({
    summary: "The last lines of one container's log, scrubbed; never the database's or meta's",
  })
  log(@Param() params: AgentLogParamDto, @Query() query: AgentLogQueryDto): Promise<AgentLogDto> {
    return this.agentLogs.log(params.service, query);
  }

  @Post('containers/:service/:action')
  @HttpCode(HttpStatus.OK)
  @Throttle(AGENT_ACTION_THROTTLE)
  @ApiOperation({ summary: 'Restart or start one listed container; never stop one' })
  async containerAction(
    @Param() params: AgentContainerActionParamDto,
    @AgentActor() actor: string,
  ): Promise<AgentActionResultDto> {
    // The DTO holds the service to the list, so its key exists.
    const key = componentKeyForService(params.service) ?? params.service;
    const result = await this.systemActions.runComponentAction(key, params.action, actor);
    return maskActionResult(result, params.service, params.action);
  }

  @Post('backups')
  @HttpCode(HttpStatus.ACCEPTED)
  @Throttle(AGENT_ACTION_THROTTLE)
  @ApiOperation({ summary: 'Run a backup now; a held ops lock answers 409' })
  async runBackup(@AgentActor() actor: string): Promise<AgentBackupStartedDto> {
    return maskBackupStarted(await this.backupsService.triggerBackup(actor));
  }

  @Post('tls/renew')
  @HttpCode(HttpStatus.OK)
  @Throttle(AGENT_ACTION_THROTTLE)
  @ApiOperation({ summary: 'Renew the certificates: Traefik restarts a moment after the answer' })
  async renewCertificates(@AgentActor() actor: string): Promise<AgentActionResultDto> {
    const result = await this.systemActions.renewCertificates(actor);
    return maskActionResult(result, 'traefik', 'renew-certs');
  }
}
