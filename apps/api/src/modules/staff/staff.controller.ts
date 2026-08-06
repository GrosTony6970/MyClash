import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Req,
  Res,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { ADMIN_READ_THROTTLE } from '../../common/throttling/throttle-profiles';
import { buildClearCookieOptions, buildSessionCookieOptions } from '../../security/http-security';
import { SupabaseService } from '../supabase/supabase.service';
import {
  CreateStaffAccountDto,
  ResetStaffPinDto,
  SetStaffLicesDto,
  StaffHeartbeatDto,
  StaffLoginDto,
  UpdateStaffAccountDto,
} from './dto';
import { Public } from '../../common/auth/public.decorator';
import { STAFF_COOKIE_NAME, StaffService } from './staff.service';

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

@ApiTags('staff')
@Controller()
export class StaffController {
  constructor(
    private readonly staff: StaffService,
    private readonly supabase: SupabaseService,
  ) {}

  @Get('events/:eventId/staff-accounts')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List local event staff accounts' })
  @ApiParam({ name: 'eventId', type: 'string', format: 'uuid' })
  async listAccounts(@Param('eventId', ParseUUIDPipe) eventId: string, @Req() req: FastifyRequest) {
    const userId = await getUserId(req, this.supabase);
    return this.staff.listAccounts(eventId, userId);
  }

  @Post('events/:eventId/staff-accounts')
  @HttpCode(HttpStatus.CREATED)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a local event staff account' })
  async createAccount(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Body() dto: CreateStaffAccountDto,
    @Req() req: FastifyRequest,
  ) {
    const userId = await getUserId(req, this.supabase);
    return this.staff.createAccount(eventId, dto, userId);
  }

  @Patch('events/:eventId/staff-accounts/:staffAccountId')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update or disable a local event staff account' })
  async updateAccount(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Param('staffAccountId', ParseUUIDPipe) staffAccountId: string,
    @Body() dto: UpdateStaffAccountDto,
    @Req() req: FastifyRequest,
  ) {
    const userId = await getUserId(req, this.supabase);
    return this.staff.updateAccount(eventId, staffAccountId, dto, userId);
  }

  @Post('events/:eventId/staff-accounts/:staffAccountId/reset-pin')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Reset a local event staff PIN' })
  async resetPin(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Param('staffAccountId', ParseUUIDPipe) staffAccountId: string,
    @Body() dto: ResetStaffPinDto,
    @Req() req: FastifyRequest,
  ) {
    const userId = await getUserId(req, this.supabase);
    return this.staff.resetPin(eventId, staffAccountId, dto, userId);
  }

  @Put('events/:eventId/staff-accounts/:staffAccountId/lices')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Replace local event staff Lice assignments' })
  async setLices(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Param('staffAccountId', ParseUUIDPipe) staffAccountId: string,
    @Body() dto: SetStaffLicesDto,
    @Req() req: FastifyRequest,
  ) {
    const userId = await getUserId(req, this.supabase);
    return this.staff.setLices(eventId, staffAccountId, dto, userId);
  }

  // Polled every 7s by every open Live board tab, and an event is run from
  // several at once (control desk, head ref, a phone in the hall). On the
  // global 120/min bucket three tabs behind one venue IP already sit at the
  // ceiling; ADMIN_READ_THROTTLE is the profile written for exactly this.
  @Get('events/:eventId/live-board')
  @Throttle(ADMIN_READ_THROTTLE)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Live control-room board: per-lice score + scorer + tablet health' })
  @ApiParam({ name: 'eventId', type: 'string', format: 'uuid' })
  async liveBoard(@Param('eventId', ParseUUIDPipe) eventId: string, @Req() req: FastifyRequest) {
    return this.staff.getLiveBoard(req, eventId);
  }

  @Post('events/:eventId/live/attention/:staffAccountId/ack')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Acknowledge (clear) a scorer needs-attention flag from the Live board',
  })
  @ApiParam({ name: 'eventId', type: 'string', format: 'uuid' })
  @ApiParam({ name: 'staffAccountId', type: 'string', format: 'uuid' })
  async ackAttention(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Param('staffAccountId', ParseUUIDPipe) staffAccountId: string,
    @Req() req: FastifyRequest,
  ) {
    return this.staff.acknowledgeAttention(req, eventId, staffAccountId);
  }

  @Public()
  @Post('staff-auth/login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Create a local event staff session' })
  async login(@Body() dto: StaffLoginDto, @Res({ passthrough: true }) reply: FastifyReply) {
    const result = await this.staff.login(dto);
    const cookieReply = reply as FastifyReply & {
      setCookie: (name: string, value: string, opts: Record<string, unknown>) => void;
    };
    cookieReply.setCookie(
      STAFF_COOKIE_NAME,
      result.token,
      buildSessionCookieOptions({ expires: result.expiresAt }),
    );
    return result.me;
  }

  // Logout is idempotent and reads no identity — it clears the cookie and
  // returns ok. 401ing someone for logging out when their session already
  // expired is user-hostile and would strand a stale scoring tablet on a
  // dead cookie. Mirrors auth/logout, which is public for the same reason.
  @Public()
  @Post('staff-auth/logout')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Clear the local event staff session' })
  async logout(@Res({ passthrough: true }) reply: FastifyReply) {
    const cookieReply = reply as FastifyReply & {
      clearCookie: (name: string, opts: Record<string, unknown>) => void;
    };
    cookieReply.clearCookie(STAFF_COOKIE_NAME, buildClearCookieOptions());
    return { ok: true };
  }

  @Get('staff-auth/me')
  @ApiOperation({ summary: 'Return the current local event staff session' })
  async me(@Req() req: FastifyRequest) {
    return this.staff.getMe(req);
  }

  @Get('staff/assigned-lices')
  @ApiOperation({ summary: 'List Lices assigned to the current local event staff session' })
  async assignedLices(@Req() req: FastifyRequest) {
    return this.staff.listAssignedLices(req);
  }

  @Post('staff/heartbeat')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Report scoring-tablet sync health for the Live board' })
  async heartbeat(@Body() dto: StaffHeartbeatDto, @Req() req: FastifyRequest) {
    return this.staff.recordHeartbeat(req, dto);
  }

  @Get('staff/lices/:liceId/current-match')
  @ApiOperation({ summary: 'Get the current match for an assigned Lice' })
  async assignedCurrentMatch(
    @Param('liceId', ParseUUIDPipe) liceId: string,
    @Req() req: FastifyRequest,
  ) {
    return this.staff.getAssignedLiceCurrent(req, liceId);
  }

  @Get('staff/lices/:liceId/matches')
  @ApiOperation({ summary: 'All matches on an assigned Lice, in schedule order' })
  @ApiParam({ name: 'liceId', type: 'string', format: 'uuid' })
  async assignedLiceMatches(
    @Param('liceId', ParseUUIDPipe) liceId: string,
    @Req() req: FastifyRequest,
  ) {
    return this.staff.getAssignedLiceMatches(req, liceId);
  }

  // The piste screen's pool + bracket views. Staff-scoped rather than reusing
  // /tournaments/:id/* directly: those take only an id and assert nothing about
  // which event the caller belongs to.
  @Get('staff/lices/:liceId/tournaments/:tournamentId/pools')
  @ApiOperation({ summary: 'Pools with matches for a tournament running on an assigned Lice' })
  @ApiParam({ name: 'liceId', type: 'string', format: 'uuid' })
  @ApiParam({ name: 'tournamentId', type: 'string', format: 'uuid' })
  async assignedLiceTournamentPools(
    @Param('liceId', ParseUUIDPipe) liceId: string,
    @Param('tournamentId', ParseUUIDPipe) tournamentId: string,
    @Req() req: FastifyRequest,
  ) {
    return this.staff.getAssignedLiceTournamentPools(req, liceId, tournamentId);
  }

  @Get('staff/lices/:liceId/tournaments/:tournamentId/bracket')
  @ApiOperation({ summary: 'Bracket for a tournament running on an assigned Lice' })
  @ApiParam({ name: 'liceId', type: 'string', format: 'uuid' })
  @ApiParam({ name: 'tournamentId', type: 'string', format: 'uuid' })
  async assignedLiceTournamentBracket(
    @Param('liceId', ParseUUIDPipe) liceId: string,
    @Param('tournamentId', ParseUUIDPipe) tournamentId: string,
    @Req() req: FastifyRequest,
  ) {
    return this.staff.getAssignedLiceTournamentBracket(req, liceId, tournamentId);
  }

  @Public()
  @Get('events/:eventSlug/lices/:liceName/current')
  @ApiOperation({ summary: 'Public current match and queue for a Lice' })
  async publicLiceCurrent(
    @Param('eventSlug') eventSlug: string,
    @Param('liceName') liceName: string,
  ) {
    return this.staff.getPublicLiceCurrent(eventSlug, decodeURIComponent(liceName));
  }

  @Public()
  @Get('matches/:id/display')
  @ApiOperation({ summary: 'Public read-only match display payload' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  async publicMatchDisplay(@Param('id', ParseUUIDPipe) id: string) {
    return this.staff.getPublicMatchDisplay(id);
  }

  @Get('matches/:id/neighbors')
  @ApiOperation({ summary: 'Public previous + next match on the same lice' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  async matchNeighbors(@Param('id', ParseUUIDPipe) id: string) {
    return this.staff.getMatchNeighbors(id);
  }
}
