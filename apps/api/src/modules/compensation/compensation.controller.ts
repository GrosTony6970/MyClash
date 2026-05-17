import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { SupabaseService } from '../supabase/supabase.service';
import { CompensationService } from './compensation.service';
import {
  CreatePlanDto,
  TogglePaidDto,
  UpdatePlanDto,
  UpsertEventSettingsDto,
  UpsertRoleRatesDto,
  UpsertTiersDto,
} from './dto/compensation.dto';

async function getUserId(req: FastifyRequest, supabase: SupabaseService): Promise<string> {
  const authHeader = req.headers['authorization'];
  const cookies = (req as FastifyRequest & { cookies?: Record<string, string> }).cookies;
  const token = authHeader?.startsWith('Bearer ')
    ? authHeader.slice(7)
    : cookies?.['sb-access-token'];
  if (!token) return 'anonymous';
  const user = await supabase.getAuthUser(token);
  return user?.id ?? 'anonymous';
}

@ApiTags('compensation')
@Controller()
export class CompensationController {
  constructor(
    private readonly compensation: CompensationService,
    private readonly supabase: SupabaseService,
  ) {}

  // ── Plans ──────────────────────────────────────────────────────────────────

  /** GET /api/v1/compensation-plans */
  @Get('compensation-plans')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List available compensation plans (built-in + org + public)' })
  async listPlans(@Req() req: FastifyRequest) {
    const userId = await getUserId(req, this.supabase);
    return this.compensation.listPlans(userId);
  }

  /** POST /api/v1/organizations/:orgId/compensation-plans */
  @Post('organizations/:orgId/compensation-plans')
  @HttpCode(HttpStatus.CREATED)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a compensation plan for an org' })
  @ApiParam({ name: 'orgId', type: 'string', format: 'uuid' })
  async createPlan(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Body() dto: CreatePlanDto,
    @Req() req: FastifyRequest,
  ) {
    const userId = await getUserId(req, this.supabase);
    return this.compensation.createPlan(dto, userId, orgId);
  }

  /** PATCH /api/v1/compensation-plans/:planId */
  @Patch('compensation-plans/:planId')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update a compensation plan' })
  @ApiParam({ name: 'planId', type: 'string', format: 'uuid' })
  async updatePlan(
    @Param('planId', ParseUUIDPipe) planId: string,
    @Body() dto: UpdatePlanDto,
    @Req() req: FastifyRequest,
  ) {
    const userId = await getUserId(req, this.supabase);
    return this.compensation.updatePlan(planId, dto, userId);
  }

  /** DELETE /api/v1/compensation-plans/:planId */
  @Delete('compensation-plans/:planId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete an org compensation plan' })
  @ApiParam({ name: 'planId', type: 'string', format: 'uuid' })
  async deletePlan(@Param('planId', ParseUUIDPipe) planId: string, @Req() req: FastifyRequest) {
    const userId = await getUserId(req, this.supabase);
    await this.compensation.deletePlan(planId, userId);
  }

  /** PUT /api/v1/compensation-plans/:planId/role-rates */
  @Put('compensation-plans/:planId/role-rates')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Replace all role rates for a plan' })
  @ApiParam({ name: 'planId', type: 'string', format: 'uuid' })
  async upsertRoleRates(
    @Param('planId', ParseUUIDPipe) planId: string,
    @Body() dto: UpsertRoleRatesDto,
    @Req() req: FastifyRequest,
  ) {
    const userId = await getUserId(req, this.supabase);
    return this.compensation.upsertRoleRates(planId, dto.rates, userId);
  }

  /** PUT /api/v1/compensation-plans/:planId/tiers */
  @Put('compensation-plans/:planId/tiers')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Replace all tiers for a plan' })
  @ApiParam({ name: 'planId', type: 'string', format: 'uuid' })
  async upsertTiers(
    @Param('planId', ParseUUIDPipe) planId: string,
    @Body() dto: UpsertTiersDto,
    @Req() req: FastifyRequest,
  ) {
    const userId = await getUserId(req, this.supabase);
    return this.compensation.upsertTiers(planId, dto.tiers, userId);
  }

  // ── Event compensation ─────────────────────────────────────────────────────

  /** GET /api/v1/events/:eventId/compensation/settings */
  @Get('events/:eventId/compensation/settings')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get compensation settings for an event' })
  @ApiParam({ name: 'eventId', type: 'string', format: 'uuid' })
  async getEventSettings(@Param('eventId', ParseUUIDPipe) eventId: string) {
    return this.compensation.getEventSettings(eventId);
  }

  /** PUT /api/v1/events/:eventId/compensation/settings */
  @Put('events/:eventId/compensation/settings')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Set compensation plan + cap for an event' })
  @ApiParam({ name: 'eventId', type: 'string', format: 'uuid' })
  async upsertEventSettings(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Body() dto: UpsertEventSettingsDto,
    @Req() req: FastifyRequest,
  ) {
    const userId = await getUserId(req, this.supabase);
    return this.compensation.upsertEventSettings(eventId, dto, userId);
  }

  /** GET /api/v1/events/:eventId/compensation/report */
  @Get('events/:eventId/compensation/report')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Compute live compensation report for an event' })
  @ApiParam({ name: 'eventId', type: 'string', format: 'uuid' })
  async getReport(@Param('eventId', ParseUUIDPipe) eventId: string) {
    return this.compensation.computeReport(eventId);
  }

  /** PATCH /api/v1/events/:eventId/compensation/payments/:userId */
  @Patch('events/:eventId/compensation/payments/:refereeUserId')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Toggle paid status for a referee' })
  @ApiParam({ name: 'eventId', type: 'string', format: 'uuid' })
  @ApiParam({ name: 'refereeUserId', type: 'string', format: 'uuid' })
  async togglePaid(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Param('refereeUserId', ParseUUIDPipe) refereeUserId: string,
    @Body() dto: TogglePaidDto,
    @Req() req: FastifyRequest,
  ) {
    const actorId = await getUserId(req, this.supabase);
    await this.compensation.togglePaid(eventId, refereeUserId, dto.paid, actorId);
  }
}
