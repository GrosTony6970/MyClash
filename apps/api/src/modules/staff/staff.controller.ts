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
import type { FastifyReply, FastifyRequest } from 'fastify';
import { buildClearCookieOptions, buildSessionCookieOptions } from '../../security/http-security';
import { SupabaseService } from '../supabase/supabase.service';
import {
  CreateStaffAccountDto,
  ResetStaffPinDto,
  SetStaffLicesDto,
  StaffLoginDto,
  UpdateStaffAccountDto,
} from './dto';
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

  @Get('staff/lices/:liceId/current-match')
  @ApiOperation({ summary: 'Get the current match for an assigned Lice' })
  async assignedCurrentMatch(
    @Param('liceId', ParseUUIDPipe) liceId: string,
    @Req() req: FastifyRequest,
  ) {
    return this.staff.getAssignedLiceCurrent(req, liceId);
  }

  @Get('events/:eventSlug/lices/:liceName/current')
  @ApiOperation({ summary: 'Public current match and queue for a Lice' })
  async publicLiceCurrent(
    @Param('eventSlug') eventSlug: string,
    @Param('liceName') liceName: string,
  ) {
    return this.staff.getPublicLiceCurrent(eventSlug, decodeURIComponent(liceName));
  }

  @Get('matches/:id/display')
  @ApiOperation({ summary: 'Public read-only match display payload' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  async publicMatchDisplay(@Param('id', ParseUUIDPipe) id: string) {
    return this.staff.getPublicMatchDisplay(id);
  }
}
