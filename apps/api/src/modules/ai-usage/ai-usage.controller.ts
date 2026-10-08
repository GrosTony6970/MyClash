import {
  BadRequestException,
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { OrganizationsService } from '../organizations/organizations.service';
import { resolveRequestUserId } from '../../common/auth/request-user';
import { SupabaseService } from '../supabase/supabase.service';
import { AIUsageService } from './ai-usage.service';

@ApiTags('ai-usage')
@ApiBearerAuth()
@Controller('events')
export class AIUsageController {
  constructor(
    private readonly service: AIUsageService,
    private readonly supabase: SupabaseService,
    private readonly orgs: OrganizationsService,
  ) {}

  /** GET /api/v1/events/:eventId/ai-usage */
  @Get(':eventId/ai-usage')
  @ApiOperation({ summary: 'Get AI spend summary for event' })
  @ApiParam({ name: 'eventId', type: 'string', format: 'uuid' })
  async getUsage(@Param('eventId', ParseUUIDPipe) eventId: string, @Req() req: FastifyRequest) {
    const orgId = await this.resolveEventOrganizationId(eventId);
    const userId = await resolveRequestUserId(req, this.supabase);
    await this.orgs.assertOrgRole(orgId, userId, 'admin');
    return this.service.getUsageSummary(eventId);
  }

  private async resolveEventOrganizationId(eventId: string): Promise<string> {
    const { data, error } = await this.supabase.service
      .from('events')
      .select('organization_id')
      .eq('id', eventId)
      .maybeSingle();

    if (error) throw new BadRequestException(error.message);
    const orgId = (data as { organization_id?: string } | null)?.organization_id;
    if (!orgId) throw new NotFoundException(`Event ${eventId} not found`);
    return orgId;
  }
}
