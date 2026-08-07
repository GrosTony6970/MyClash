import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PlatformRoleGuard } from './guards/platform-role.guard';
import { NotificationsSummaryService } from './notifications-summary.service';

@ApiTags('super-admin')
@ApiBearerAuth()
@UseGuards(PlatformRoleGuard)
@Controller('admin/notifications')
export class NotificationsSummaryController {
  constructor(private readonly summary: NotificationsSummaryService) {}

  @Get('summary')
  @ApiOperation({
    summary:
      'Aggregated pending-attention counts for the super-admin notification bell + sidebar badge',
  })
  async getSummary() {
    return this.summary.getSummary();
  }
}
