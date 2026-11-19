import { Controller, Get, HttpCode, HttpStatus, Post, Req, UseGuards } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { getActorId } from '../../common/auth/actor';
import type { HostInfoResponseDto } from './dto/host-info.dto';
import { PlatformRoleGuard } from './guards/platform-role.guard';
import { AdminHostInfoService } from './host-info.service';
import { AdminSystemActionsService, type DiskPruneResult } from './system-actions.service';

// No @PlatformRole decorator: PlatformRoleGuard defaults a GET to
// platform_viewer, which is what this is — a read-only inventory panel, same
// tier as tls-status and runtime-health beside it. Naming the role explicitly on
// a GET would be a silent no-op, so the default is the deliberate choice. The
// prune is a POST: the guard's default reserves it to a super admin.
@ApiTags('admin')
@ApiCookieAuth('sb-access-token')
@UseGuards(PlatformRoleGuard)
@Controller('admin/system/host-info')
export class HostInfoAdminController {
  constructor(
    private readonly hostInfo: AdminHostInfoService,
    private readonly systemActions: AdminSystemActionsService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Report host identity, CPU, memory and disk capacity' })
  getHostInfo(): Promise<HostInfoResponseDto> {
    return this.hostInfo.collect();
  }

  @Post('prune')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Free disk space: empty Docker's build cache, remove the dangling images",
  })
  prune(@Req() req: FastifyRequest): Promise<DiskPruneResult> {
    return this.systemActions.pruneDisk(getActorId(req));
  }
}
