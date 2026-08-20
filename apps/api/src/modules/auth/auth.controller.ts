import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query, Req, Res } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { FastifyReply, FastifyRequest } from 'fastify';
import {
  AUTH_ACTION_THROTTLE,
  SIGNUP_ACTION_THROTTLE,
} from '../../common/throttling/throttle-profiles';
import { ThrottleByEmail } from '../../common/throttling/throttle-by-email';
import { requestAcceptanceContext } from '../../common/legal/acceptance-context';
import { acceptedVersionsOf } from '../../common/legal/accepted-legal.schema';
import { AuthService } from './auth.service';
import { MeResponseDto } from './dto/me-response.dto';
import { OAuthSessionDto } from './dto/oauth-session.dto';
import { PasswordLoginDto } from './dto/password-login.dto';
import {
  PublicLoginDto,
  PublicPasswordResetConfirmDto,
  PublicPasswordResetDto,
  PublicSignupDto,
} from './dto/public-auth.dto';
import { Public } from '../../common/auth/public.decorator';
import { RequestMagicLinkDto } from './dto/request-magic-link.dto';

// Every route here is part of the pre-session bootstrap — magic link, OAuth
// exchange, password login, public signup/reset, the OAuth callback, logout,
// and identity discovery. By definition the caller has no identity yet, so
// requiring one would deadlock login. They authenticate internally where it
// matters (e.g. oauth/session validates the code it is handed).
@Public()
@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  /**
   * POST /api/v1/auth/magic-link
   *
   * Request a magic link. Used by:
   * - Organizer login (admin app): type='login'
   * - Participant claim (public app): type='claim', personId required
   *
   * Rate limited: 10 per hour per IP (via ThrottlerGuard). Supabase applies its
   * own per-address limit on the email send itself.
   * Always returns the same generic message to prevent email enumeration.
   */
  @Post('magic-link')
  @HttpCode(HttpStatus.OK)
  @Throttle(AUTH_ACTION_THROTTLE)
  @ApiOperation({ summary: 'Request a magic link (login or claim)' })
  @ApiResponse({
    status: 200,
    description: 'Magic link sent (or silently dropped if email unknown)',
  })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 429, description: 'Rate limit exceeded' })
  async requestMagicLink(@Body() dto: RequestMagicLinkDto): Promise<{ message: string }> {
    return this.authService.requestMagicLink(dto);
  }

  @Post('oauth/session')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Accept an OAuth session and set MyClash auth cookies' })
  @ApiResponse({ status: 200, description: 'OAuth session accepted' })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 401, description: 'Invalid OAuth session' })
  @ApiResponse({ status: 403, description: 'OAuth user is not authorized for this flow' })
  async acceptOAuthSession(
    @Body() dto: OAuthSessionDto,
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    await this.authService.acceptOAuthSession(dto, reply, requestAcceptanceContext(request));
  }

  /**
   * POST /api/v1/auth/password-login
   *
   * Rate limited: 10 per hour per IP, and 10 per hour per email address shared
   * with `public-login` (both are sign-ins for the same Supabase account).
   */
  @Post('password-login')
  @HttpCode(HttpStatus.OK)
  @Throttle(AUTH_ACTION_THROTTLE)
  @ThrottleByEmail()
  @ApiOperation({ summary: 'Sign in with email and password for admin access' })
  @ApiResponse({ status: 200, description: 'Password session accepted' })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 401, description: 'Invalid credentials' })
  @ApiResponse({ status: 403, description: 'User is not authorized for admin access' })
  @ApiResponse({ status: 429, description: 'Rate limit exceeded' })
  async passwordLogin(@Body() dto: PasswordLoginDto, @Res() reply: FastifyReply): Promise<void> {
    await this.authService.passwordLogin(dto, reply);
  }

  /**
   * POST /api/v1/auth/public-signup
   *
   * Create a Supabase auth.users row with email + password. Supabase
   * sends its built-in confirmation email; the user can't log in
   * until they click the link. Gated by the disable_public_signups
   * feature flag.
   */
  @Post('public-signup')
  @HttpCode(HttpStatus.ACCEPTED)
  @Throttle(SIGNUP_ACTION_THROTTLE)
  @ApiOperation({ summary: 'Create a public email + password account' })
  @ApiResponse({ status: 202, description: 'Confirmation email queued' })
  @ApiResponse({ status: 400, description: 'Weak password' })
  @ApiResponse({ status: 503, description: 'Signups temporarily disabled' })
  async publicSignup(
    @Body() dto: PublicSignupDto,
    @Req() request: FastifyRequest,
  ): Promise<{ message: string }> {
    return this.authService.publicSignup(
      dto.email,
      dto.password,
      acceptedVersionsOf(dto),
      requestAcceptanceContext(request),
    );
  }

  /**
   * POST /api/v1/auth/public-login
   *
   * Email + password sign-in for the public app. Unlike `password-login`
   * this does NOT require admin/organizer access. Surfaces
   * `email_not_confirmed` as a 403 so the UI can route to the "check
   * your inbox" state.
   *
   * Rate limited: 10 per hour per IP, and 10 per hour per email address shared
   * with `password-login`.
   */
  @Post('public-login')
  @HttpCode(HttpStatus.OK)
  @Throttle(AUTH_ACTION_THROTTLE)
  @ThrottleByEmail()
  @ApiOperation({ summary: 'Sign in to the public app with email + password' })
  @ApiResponse({ status: 200, description: 'Session accepted' })
  @ApiResponse({ status: 401, description: 'Invalid credentials' })
  @ApiResponse({ status: 403, description: 'email_not_confirmed' })
  @ApiResponse({ status: 429, description: 'Rate limit exceeded' })
  async publicLogin(@Body() dto: PublicLoginDto, @Res() reply: FastifyReply): Promise<void> {
    await this.authService.publicLogin(dto.email, dto.password, reply);
  }

  /**
   * POST /api/v1/auth/public-password-reset
   *
   * Request a password reset email. Always 202 + generic message.
   */
  @Post('public-password-reset')
  @HttpCode(HttpStatus.ACCEPTED)
  @Throttle(SIGNUP_ACTION_THROTTLE)
  @ApiOperation({ summary: 'Request a password reset email' })
  @ApiResponse({ status: 202, description: 'Reset link sent (or silently dropped)' })
  async publicPasswordReset(@Body() dto: PublicPasswordResetDto): Promise<{ message: string }> {
    return this.authService.publicPasswordReset(dto.email, dto.type);
  }

  /**
   * POST /api/v1/auth/public-password-reset-confirm
   *
   * Exchange the recovery token for a session and set the new password.
   */
  @Post('public-password-reset-confirm')
  @HttpCode(HttpStatus.OK)
  @Throttle(AUTH_ACTION_THROTTLE)
  @ApiOperation({ summary: 'Confirm a password reset and sign in' })
  @ApiResponse({ status: 200, description: 'Password updated + session set' })
  @ApiResponse({ status: 400, description: 'Weak password' })
  @ApiResponse({ status: 401, description: 'Invalid or expired token' })
  async publicPasswordResetConfirm(
    @Body() dto: PublicPasswordResetConfirmDto,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    await this.authService.publicPasswordResetConfirm(dto.token, dto.password, reply);
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Clear admin auth session cookies' })
  @ApiResponse({ status: 200, description: 'Session cookies cleared' })
  logout(@Res({ passthrough: true }) reply: FastifyReply): { ok: true } {
    return this.authService.logout(reply);
  }

  /**
   * GET /api/v1/auth/callback
   *
   * Supabase Auth redirects here after the user clicks the magic link.
   * Exchanges the token for a session, sets cookies, and redirects to the app.
   */
  @Get('callback')
  @ApiOperation({ summary: 'Magic link callback — exchanges token for session' })
  @ApiQuery({ name: 'token_hash', required: true })
  @ApiQuery({ name: 'type', required: false })
  @ApiQuery({ name: 'personId', required: false })
  @ApiQuery({ name: 'next', required: false })
  async callback(
    @Query('token_hash') tokenHash: string,
    @Query('type') type: string = 'login',
    @Query('personId') personId: string | undefined,
    @Query('next') next: string | undefined,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    await this.authService.handleCallback(tokenHash, type, personId, next, reply);
  }

  /**
   * GET /api/v1/auth/me
   *
   * Returns the current identity: claimed user, guest session, or anonymous.
   * Reads the Supabase access token from the Authorization header or cookie.
   *
   * NOT `/api/v1/me` — this controller is `@Controller('auth')`, and the
   * docstring said otherwise until 2026-08-20. The two are separate routes and
   * `public-routes.test.ts` requires both to answer `anonymous` with a 200.
   * They differ in one way: only `/api/v1/me` takes a `reply`, so only that one
   * performs the guest-cookie consolidation. Read `me.controller.ts` before
   * assuming a caller can be moved between them.
   */
  @Get('me')
  @ApiOperation({ summary: 'Get current identity' })
  @ApiResponse({ status: 200, type: MeResponseDto })
  async getMe(@Req() request: FastifyRequest): Promise<MeResponseDto> {
    return this.authService.getMe(request);
  }
}
