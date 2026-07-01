import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { AIProvidersService } from '../ai-providers/ai-providers.service';
import { UpdateBudgetDto } from '../ai-providers/dto/update-budget.dto';
import { OrganizationsService } from '../organizations/organizations.service';
import { SupabaseService } from '../supabase/supabase.service';
import { AIUsageService } from './ai-usage.service';

async function getUserId(req: FastifyRequest, supabase: SupabaseService): Promise<string> {
  const authHeader = req.headers['authorization'];
  const cookies = (req as FastifyRequest & { cookies?: Record<string, string> }).cookies;
  const token = authHeader?.startsWith('Bearer ')
    ? authHeader.slice(7)
    : cookies?.['sb-access-token'];
  if (!token) return 'anonymous';
  const {
    data: { user },
  } = await supabase.anon.auth.getUser(token);
  return user?.id ?? 'anonymous';
}

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
    const userId = await getUserId(req, this.supabase);
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
    const userId = await getUserId(req, this.supabase);
    await this.orgs.assertOrgRole(orgId, userId, 'admin');
    await this.providers.updateBudget(orgId, dto.monthlyBudgetEur);
    return this.providers.getProviderConfig(orgId);
  }
}
