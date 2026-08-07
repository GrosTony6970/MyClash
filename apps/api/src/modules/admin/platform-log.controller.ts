import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminPlatformLogService } from './admin-platform-log.service';
import { ListPlatformLogQueryDto } from './dto/admin-platform-log.dto';
import { PlatformRoleGuard } from './guards/platform-role.guard';

@ApiTags('super-admin')
@ApiBearerAuth()
@UseGuards(PlatformRoleGuard)
@Controller('admin/platform-log')
export class PlatformLogAdminController {
  constructor(private readonly service: AdminPlatformLogService) {}

  @Get()
  @ApiOperation({ summary: 'List platform/operational log entries (super admin)' })
  async list(@Query() query: ListPlatformLogQueryDto) {
    return this.service.list(query);
  }
}
