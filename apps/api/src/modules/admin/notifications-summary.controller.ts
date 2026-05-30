import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SuperAdminGuard } from './guards/super-admin.guard';
import { NotificationsSummaryService } from './notifications-summary.service';

@ApiTags('super-admin')
@ApiBearerAuth()
@UseGuards(SuperAdminGuard)
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
