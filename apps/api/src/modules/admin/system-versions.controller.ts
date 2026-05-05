import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { SystemVersionsResponseDto } from './dto/system-versions.dto';
import { SuperAdminGuard } from './guards/super-admin.guard';
import { AdminSystemVersionsService } from './system-versions.service';

@ApiTags('admin')
@ApiCookieAuth('sb-access-token')
@UseGuards(SuperAdminGuard)
@Controller('admin/system-versions')
export class SystemVersionsAdminController {
  constructor(private readonly systemVersions: AdminSystemVersionsService) {}

  @Get()
  @ApiOperation({ summary: 'Get platform component versions' })
  getSystemVersions(): Promise<SystemVersionsResponseDto> {
    return this.systemVersions.getSystemVersions();
  }
}
