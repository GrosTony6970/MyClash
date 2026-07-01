import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AIUsageService } from '../ai-usage/ai-usage.service';
import { SuperAdminGuard } from './guards/super-admin.guard';

/** Platform-wide AI consumption rollup for the super-admin dashboard. */
@ApiTags('super-admin')
@ApiBearerAuth()
@UseGuards(SuperAdminGuard)
@Controller('admin/ai-usage')
export class PlatformAIUsageController {
  constructor(private readonly usage: AIUsageService) {}

  @Get('summary')
  @ApiOperation({ summary: 'Global AI consumption rollup + per-org breakdown' })
  async summary(@Query('from') from?: string, @Query('to') to?: string) {
    return this.usage.getPlatformUsageRollup(from, to);
  }
}
