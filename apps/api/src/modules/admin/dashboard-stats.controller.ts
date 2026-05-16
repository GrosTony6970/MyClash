import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminDashboardStatsService } from './admin-dashboard-stats.service';
import { SuperAdminGuard } from './guards/super-admin.guard';

@ApiTags('super-admin')
@ApiBearerAuth()
@UseGuards(SuperAdminGuard)
@Controller('admin/dashboard-stats')
export class AdminDashboardStatsController {
  constructor(private readonly service: AdminDashboardStatsService) {}

  @Get()
  @ApiOperation({ summary: 'Read platform dashboard statistics (super admin)' })
  async getStats() {
    return this.service.getStats();
  }
}
