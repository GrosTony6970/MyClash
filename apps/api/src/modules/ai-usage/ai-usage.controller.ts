import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { AIUsageService } from './ai-usage.service';

@ApiTags('ai-usage')
@ApiBearerAuth()
@Controller('events')
export class AIUsageController {
  constructor(private readonly service: AIUsageService) {}

  /** GET /api/v1/events/:eventId/ai-usage */
  @Get(':eventId/ai-usage')
  @ApiOperation({ summary: 'Get AI spend summary for event' })
  @ApiParam({ name: 'eventId', type: 'string', format: 'uuid' })
  async getUsage(@Param('eventId', ParseUUIDPipe) eventId: string) {
    return this.service.getUsageSummary(eventId);
  }
}
