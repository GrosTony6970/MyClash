import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { SupabaseService } from '../supabase/supabase.service';
import {
  CreateLeagueMembershipRequestBodyDto,
  ReviewLeagueMembershipRequestBodyDto,
} from './dto/league-membership-requests.dto';
import { LeagueMembershipRequestsService } from './league-membership-requests.service';

async function getUserId(req: FastifyRequest, supabase: SupabaseService): Promise<string> {
  const authHeader = req.headers['authorization'];
  const cookies = (req as FastifyRequest & { cookies?: Record<string, string> }).cookies;
  const token = authHeader?.startsWith('Bearer ')
    ? authHeader.slice(7)
    : cookies?.['sb-access-token'];
  if (!token) throw new UnauthorizedException('Authentication required');
  const user = await supabase.getAuthUser(token);
  if (!user?.id) throw new UnauthorizedException('Authentication required');
  return user.id;
}

@ApiTags('leagues')
@Controller()
export class LeagueMembershipRequestsController {
  constructor(
    private readonly service: LeagueMembershipRequestsService,
    private readonly supabase: SupabaseService,
  ) {}

  // ── Org-side: submit + list own ──────────────────────────────────────────

  @Post('orgs/:orgId/league-requests')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Org admin: submit a request to join a league' })
  async submit(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Body() dto: CreateLeagueMembershipRequestBodyDto,
    @Req() req: FastifyRequest,
  ) {
    const userId = await getUserId(req, this.supabase);
    return this.service.submit(
      orgId,
      { leagueId: dto.leagueId, message: dto.message, requestedRole: dto.requestedRole },
      userId,
    );
  }

  @Get('orgs/:orgId/league-requests')
  @ApiBearerAuth()
  @ApiOperation({ summary: "Org admin: list this org's league-membership requests" })
  async listOwn(@Param('orgId', ParseUUIDPipe) orgId: string, @Req() req: FastifyRequest) {
    const userId = await getUserId(req, this.supabase);
    return this.service.listByOrganization(orgId, userId);
  }

  @Patch('orgs/:orgId/league-requests/:requestId/withdraw')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Org admin: withdraw a pending join request' })
  async withdraw(
    @Param('orgId', ParseUUIDPipe) _orgId: string,
    @Param('requestId', ParseUUIDPipe) requestId: string,
    @Req() req: FastifyRequest,
  ) {
    const userId = await getUserId(req, this.supabase);
    return this.service.withdraw(requestId, userId);
  }

  // ── Admin-side: review + list per league ─────────────────────────────────

  @Get('admin/leagues/:leagueId/membership-requests')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List org-join requests for a league' })
  async listByLeague(
    @Param('leagueId', ParseUUIDPipe) leagueId: string,
    @Query('status') status: string | undefined,
  ) {
    const allowed = ['requested', 'approved', 'rejected', 'withdrawn'] as const;
    const normalised = (allowed as readonly string[]).includes(status ?? '')
      ? (status as (typeof allowed)[number])
      : undefined;
    return this.service.listByLeague(leagueId, normalised);
  }

  @Patch('admin/league-membership-requests/:requestId')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Approve or reject an org-join request' })
  async review(
    @Param('requestId', ParseUUIDPipe) requestId: string,
    @Body() dto: ReviewLeagueMembershipRequestBodyDto,
    @Req() req: FastifyRequest,
  ) {
    const userId = await getUserId(req, this.supabase);
    return this.service.review(
      requestId,
      { status: dto.status, reviewNote: dto.reviewNote },
      userId,
    );
  }
}
