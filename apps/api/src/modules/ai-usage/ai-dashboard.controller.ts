import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { AIProvidersService } from '../ai-providers/ai-providers.service';
import { UpdateBudgetDto } from '../ai-providers/dto/update-budget.dto';
import { UpdateAIFlagsDto } from '../ai-providers/dto/update-ai-flags.dto';
import { OrganizationsService } from '../organizations/organizations.service';
import { resolveRequestUserId } from '../../common/auth/request-user';
import { SupabaseService } from '../supabase/supabase.service';
import { AIUsageService } from './ai-usage.service';

/** Org-level AI consumption dashboard: usage rollup + monthly budget. */
@ApiTags('ai-usage')
@ApiBearerAuth()
@Controller('organizations')
export class AIDashboardController {
  constructor(
    private readonly usage: AIUsageService,
    private readonly providers: AIProvidersService,
    private readonly supabase: SupabaseService,
    private readonly orgs: OrganizationsService,
  ) {}

  /** GET /api/v1/organizations/:orgId/ai-usage/summary?from&to */
  @Get(':orgId/ai-usage/summary')
  @ApiOperation({ summary: 'AI consumption rollup for an organization' })
  @ApiParam({ name: 'orgId', type: 'string', format: 'uuid' })
  async orgUsage(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Req() req: FastifyRequest,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const userId = await resolveRequestUserId(req, this.supabase);
    await this.orgs.assertOrgRole(orgId, userId, 'admin');
    return this.usage.getOrgUsageRollup(orgId, from, to);
  }

  /** PATCH /api/v1/organizations/:orgId/ai-settings/budget */
  @Patch(':orgId/ai-settings/budget')
  @ApiOperation({ summary: 'Set the org monthly AI budget' })
  @ApiParam({ name: 'orgId', type: 'string', format: 'uuid' })
  async setBudget(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Body() dto: UpdateBudgetDto,
    @Req() req: FastifyRequest,
  ) {
    const userId = await resolveRequestUserId(req, this.supabase);
    await this.orgs.assertOrgRole(orgId, userId, 'admin');
    await this.providers.updateBudget(orgId, dto.monthlyBudgetEur);
    return this.providers.getProviderConfig(orgId);
  }

  /** PATCH /api/v1/organizations/:orgId/ai-settings/flags */
  @Patch(':orgId/ai-settings/flags')
  @ApiOperation({ summary: 'Set per-org AI availability overrides' })
  @ApiParam({ name: 'orgId', type: 'string', format: 'uuid' })
  async setFlags(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Body() dto: UpdateAIFlagsDto,
    @Req() req: FastifyRequest,
  ) {
    const userId = await resolveRequestUserId(req, this.supabase);
    await this.orgs.assertOrgRole(orgId, userId, 'admin');
    await this.providers.updateFlags(orgId, dto);
    return this.providers.getProviderConfig(orgId);
  }
}
