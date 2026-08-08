import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { HostInfoResponseDto } from './dto/host-info.dto';
import { PlatformRoleGuard } from './guards/platform-role.guard';
import { AdminHostInfoService } from './host-info.service';

// No @PlatformRole decorator: PlatformRoleGuard defaults a GET to
// platform_viewer, which is what this is — a read-only inventory panel, same
// tier as tls-status and runtime-health beside it. Naming the role explicitly on
// a GET would be a silent no-op, so the default is the deliberate choice.
@ApiTags('admin')
@ApiCookieAuth('sb-access-token')
@UseGuards(PlatformRoleGuard)
@Controller('admin/system/host-info')
export class HostInfoAdminController {
  constructor(private readonly hostInfo: AdminHostInfoService) {}

  @Get()
  @ApiOperation({ summary: 'Report host identity, CPU, memory and disk capacity' })
  getHostInfo(): Promise<HostInfoResponseDto> {
    return this.hostInfo.collect();
  }
}
