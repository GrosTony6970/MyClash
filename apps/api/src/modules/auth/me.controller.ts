import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
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
import { ChangePasswordDto, DeleteAccountDto } from './dto/security.dto';

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
  ): Promise<
    { status: 'confirmation_sent'; redactedEmail: string } | { status: 'pending_approval' }
  > {
    return this.auth.requestGlobalPersonClaim(req, dto.globalPersonId);
  }

  /**
   * DELETE /api/v1/me/global-person-link
   *
   * "This isn't me." Clears claimed_by_user_id on the row currently
   * linked to the caller. Idempotent.
   */
  @Delete('me/global-person-link')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Unlink the current user from their global profile' })
  @ApiResponse({ status: 200, description: 'Unlinked (or no-op if not linked)' })
  async unlinkGlobalPerson(
    @Req() req: FastifyRequest,
  ): Promise<{ ok: true; unlinkedGlobalPersonId: string | null }> {
    return this.auth.unlinkGlobalPerson(req);
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

  /**
   * GET /api/v1/me/security-status
   *
   * Tells the /profile/security UI whether the current user has a
   * usable email/password identity (vs. Google-only signup), so the
   * page can render the right Change-password and Delete-account
   * variants.
   */
  @Get('me/security-status')
  @ApiOperation({ summary: 'Security status (does this user have a password set)' })
  @ApiResponse({ status: 200, description: '{ hasPassword, email }' })
  async getSecurityStatus(
    @Req() req: FastifyRequest,
  ): Promise<{ hasPassword: boolean; email: string | null }> {
    return this.auth.getSecurityStatus(req);
  }

  /**
   * POST /api/v1/me/change-password
   *
   * Update the current user's password. Requires the current
   * password as defense in depth (cookie alone is not enough).
   */
  @Post('me/change-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Change the current user password' })
  @ApiResponse({ status: 200, description: 'Password updated' })
  @ApiResponse({ status: 400, description: 'Weak new password' })
  @ApiResponse({ status: 401, description: 'Current password incorrect / no session' })
  async changePassword(
    @Req() req: FastifyRequest,
    @Body() dto: ChangePasswordDto,
  ): Promise<{ ok: true }> {
    return this.auth.changePassword(req, dto.currentPassword, dto.newPassword);
  }

  /**
   * DELETE /api/v1/me/account
   *
   * Irreversibly delete the current user's auth row and strip
   * claim linkages on global_persons + persons (history rows
   * survive). Requires the current password and literal 'DELETE'
   * confirmation. v1 refuses for users without a password
   * identity — they should set one via change-password first.
   */
  @Delete('me/account')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete the current user account' })
  @ApiResponse({ status: 200, description: 'Account deleted; cookies cleared' })
  @ApiResponse({
    status: 400,
    description: 'Confirmation typo / Google-only user (no_password_set)',
  })
  @ApiResponse({ status: 401, description: 'Wrong current password' })
  async deleteAccount(
    @Req() req: FastifyRequest,
    @Body() dto: DeleteAccountDto,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    await this.auth.deleteAccount(req, dto.currentPassword, dto.confirmation, reply);
  }
}
