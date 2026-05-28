import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query, Req, Res } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { AuthService, type GlobalPersonSearchResult } from './auth.service';
import {
  GlobalPersonClaimConfirmDto,
  GlobalPersonClaimRequestDto,
} from './dto/global-person-claim.dto';
import { MeResponseDto } from './dto/me-response.dto';
import { PersonalSpaceResponseDto } from './dto/personal-space-response.dto';

class GlobalPersonSearchQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;
}

@ApiTags('auth')
@Controller()
export class MeController {
  constructor(private readonly auth: AuthService) {}

  /**
   * GET /api/v1/me
   *
   * Returns the current identity:
   *   - claimed: Supabase JWT present and valid
   *   - guest:   mc_guest cookie present and valid (no Supabase JWT)
   *   - anonymous: neither
   *
   * When both claimed + guest are present, claimed wins and the guest
   * cookie is cleared (consolidation).
   */
  @Get('me')
  @ApiOperation({ summary: 'Get current identity (claimed / guest / anonymous)' })
  @ApiResponse({ status: 200, type: MeResponseDto })
  async getMe(@Req() req: FastifyRequest, @Res() reply: FastifyReply): Promise<void> {
    const result = await this.auth.getMe(req, reply);
    void reply.status(200).send(result);
  }

  @Get('me/personal-space')
  @ApiOperation({ summary: 'Get current claimed user personal-space data' })
  @ApiResponse({ status: 200, type: PersonalSpaceResponseDto })
  async getPersonalSpace(@Req() req: FastifyRequest): Promise<PersonalSpaceResponseDto> {
    return this.auth.getPersonalSpace(req);
  }

  /**
   * GET /api/v1/me/global-person-search?q=...
   *
   * Search for an unclaimed global profile to self-claim. Returns at
   * most 20 ranked rows. Email and DOB are never projected.
   */
  @Get('me/global-person-search')
  @ApiOperation({ summary: 'Search unclaimed global profiles by name/club' })
  @ApiQuery({ name: 'q', type: 'string', required: false })
  @ApiResponse({ status: 200, description: 'Matching profiles (no PII)' })
  async searchGlobalPersons(
    @Req() req: FastifyRequest,
    @Query() query: GlobalPersonSearchQueryDto,
  ): Promise<GlobalPersonSearchResult[]> {
    return this.auth.searchGlobalPersonsForClaim(req, query.q ?? '');
  }

  /**
   * POST /api/v1/me/global-person-claim
   *
   * Request a claim. If `global_persons.email` is set, a magic link
   * is mailed to that address — clicking it confirms the claim.
   */
  @Post('me/global-person-claim')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Request claim of a global profile' })
  @ApiResponse({ status: 200, description: 'Confirmation email sent' })
  @ApiResponse({ status: 400, description: 'Profile has no email on file / already claimed' })
  async requestGlobalPersonClaim(
    @Req() req: FastifyRequest,
    @Body() dto: GlobalPersonClaimRequestDto,
  ): Promise<{ status: 'confirmation_sent'; redactedEmail: string }> {
    return this.auth.requestGlobalPersonClaim(req, dto.globalPersonId);
  }

  /**
   * POST /api/v1/me/claim-confirm
   *
   * Finalize a claim using the one-time token from the email.
   */
  @Post('me/claim-confirm')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Confirm a pending global profile claim' })
  @ApiResponse({ status: 200, description: 'Profile claimed' })
  @ApiResponse({ status: 400, description: 'Token expired, used, or profile already claimed' })
  @ApiResponse({ status: 403, description: 'Token does not match current session' })
  async confirmGlobalPersonClaim(
    @Req() req: FastifyRequest,
    @Body() dto: GlobalPersonClaimConfirmDto,
  ): Promise<{ status: 'claimed'; globalPersonId: string }> {
    return this.auth.confirmGlobalPersonClaim(req, dto.token);
  }
}
