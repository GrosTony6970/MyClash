import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminCiHealthService } from './ci-health.service';
import type { CiHealthResponseDto } from './dto/ci-health.dto';
import { PlatformRoleGuard } from './guards/platform-role.guard';

// No @PlatformRole decorator: PlatformRoleGuard defaults a GET to
// platform_viewer, which is what this is — a read-only diagnostic panel, same
// tier as host-info, tls-status and runtime-health beside it. Naming the role
// explicitly on a GET would be a silent no-op, so the default is the deliberate
// choice.
@ApiTags('admin')
@ApiCookieAuth('sb-access-token')
@UseGuards(PlatformRoleGuard)
@Controller('admin/system/ci-health')
export class CiHealthAdminController {
  constructor(private readonly ciHealth: AdminCiHealthService) {}

  @Get()
  @ApiOperation({ summary: 'Report which CI gates ran on the last run, and which never reported' })
  getCiHealth(): Promise<CiHealthResponseDto> {
    return this.ciHealth.collect();
  }
}
