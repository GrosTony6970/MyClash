import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  Req,
  Res,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { SIGNUP_ACTION_THROTTLE } from '../../common/throttling/throttle-profiles';
import { isFlagEnabledDirect } from '../../common/feature-flag-direct';
import { OnboardingService } from '../organizations/onboarding.service';
import { CheckSlugDto, SignupDto } from '../organizations/dto/signup.dto';
import { SupabaseService } from '../supabase/supabase.service';
import { Public } from '../../common/auth/public.decorator';
import { requestAcceptanceContext } from '../../common/legal/acceptance-context';
import { LegalAcceptanceService } from '../privacy/legal-acceptance.service';
import { AuthService } from './auth.service';

// Pre-session bootstrap: org signup, slug availability, signup callback.
// The caller has no identity yet by definition.
@Public()
@ApiTags('auth')
@Controller('auth')
export class SignupController {
  constructor(
    private readonly onboarding: OnboardingService,
    private readonly auth: AuthService,
    private readonly supabase: SupabaseService,
    private readonly legal: LegalAcceptanceService,
  ) {}

  /**
   * POST /api/v1/auth/signup
   *
   * Two-step organizer signup. Step 1 (account) is client-side only.
   * This endpoint is called on step 2 submission (org name + slug).
   *
   * Rate limited: 5 per hour per IP.
   */
  @Post('signup')
  @HttpCode(HttpStatus.CREATED)
  @Throttle(SIGNUP_ACTION_THROTTLE)
  @ApiOperation({ summary: 'Organizer self-service signup' })
  @ApiResponse({ status: 201, description: 'Signup initiated' })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 409, description: 'Slug already taken or reserved' })
  @ApiResponse({ status: 429, description: 'Rate limit exceeded' })
  async signup(@Body() dto: SignupDto, @Req() request: FastifyRequest) {
    if (await isFlagEnabledDirect(this.supabase, 'disable_signups')) {
      throw new ServiceUnavailableException('Signups are temporarily disabled');
    }
    return this.onboarding.signup(dto, requestAcceptanceContext(request));
  }

  /**
   * GET /api/v1/auth/check-slug?slug=...
   *
   * Real-time slug availability check (debounced on the frontend).
   * Returns { available: boolean, reason?: 'reserved' | 'taken' }.
   */
  @Get('check-slug')
  @ApiOperation({ summary: 'Check organization slug availability' })
  @ApiQuery({ name: 'slug', required: true })
  @ApiResponse({ status: 200, description: 'Availability result' })
  async checkSlug(@Query() query: CheckSlugDto) {
    return this.onboarding.checkSlugAvailability(query.slug);
  }

  /**
   * GET /api/v1/auth/signup-callback
   *
   * Called after the magic-link signup flow. The magic link redirects here
   * with the org creation payload in query params. We exchange the token,
   * create the org, and redirect to the org dashboard.
   */
  @Get('signup-callback')
  @ApiOperation({ summary: 'Magic-link signup callback — creates org and redirects' })
  @ApiQuery({ name: 'token_hash', required: true })
  @ApiQuery({ name: 'orgName', required: true })
  @ApiQuery({ name: 'orgSlug', required: true })
  @ApiQuery({ name: 'displayName', required: false })
  @ApiQuery({ name: 'acceptedTerms', required: false })
  @ApiQuery({ name: 'acceptedPrivacy', required: false })
  async signupCallback(
    @Query('token_hash') tokenHash: string,
    @Query('orgName') orgName: string,
    @Query('orgSlug') orgSlug: string,
    @Query('displayName') _displayName: string | undefined,
    @Query('acceptedTerms') acceptedTerms: string | undefined,
    @Query('acceptedPrivacy') acceptedPrivacy: string | undefined,
    @Req() _req: FastifyRequest,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    // Exchange the OTP token for a session (sets cookies)
    await this.auth.handleCallback(tokenHash, 'login', undefined, undefined, reply);

    // Get the user from the newly set cookie
    const cookies = (_req as FastifyRequest & { cookies: Record<string, string> }).cookies;
    const accessToken = cookies?.['sb-access-token'];

    if (accessToken) {
      const me = await this.auth.getMe(_req);
      if (me.type === 'claimed' && me.user?.id) {
        await this.onboarding.completeSignupAfterMagicLink(me.user.id, orgName, orgSlug);
        // The account exists only now, which is why the acceptance is recorded
        // here rather than when the link was requested. Not asserted: the
        // versions were already checked at /auth/signup, and a policy revised
        // between sending the mail and clicking it must not strand a user
        // mid-signup on a redirect they cannot answer. A version that no longer
        // matches simply shows up in `pendingLegal` and the banner asks again.
        await this.recordCallbackAcceptance(me.user.id, acceptedTerms, acceptedPrivacy, _req);
      }
    }

    void reply.redirect(`/org/${orgSlug}`);
  }

  private async recordCallbackAcceptance(
    userId: string,
    acceptedTerms: string | undefined,
    acceptedPrivacy: string | undefined,
    request: FastifyRequest,
  ): Promise<void> {
    if (!acceptedTerms || !acceptedPrivacy) return;
    await this.legal.recordForUser(
      userId,
      { terms: acceptedTerms, privacy: acceptedPrivacy },
      requestAcceptanceContext(request),
    );
  }
}
