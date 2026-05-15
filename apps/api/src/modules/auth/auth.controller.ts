import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query, Req, Res } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { AuthService } from './auth.service';
import { MeResponseDto } from './dto/me-response.dto';
import { OAuthSessionDto } from './dto/oauth-session.dto';
import { PasswordLoginDto } from './dto/password-login.dto';
import { RequestMagicLinkDto } from './dto/request-magic-link.dto';

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
   * Rate limited: 3 per hour per email + 10 per hour per IP (via ThrottlerGuard).
   * Always returns the same generic message to prevent email enumeration.
   */
  @Post('magic-link')
  @HttpCode(HttpStatus.OK)
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
    @Res() reply: FastifyReply,
  ): Promise<void> {
    await this.authService.acceptOAuthSession(dto, reply);
  }

  @Post('password-login')
  @HttpCode(HttpStatus.OK)
  @Throttle({ auth: { limit: 10, ttl: 3_600_000 } })
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
    @Query('next') _next: string | undefined,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    await this.authService.handleCallback(tokenHash, type, personId, reply);
  }

  /**
   * GET /api/v1/me
   *
   * Returns the current identity: claimed user, guest session, or anonymous.
   * Reads the Supabase access token from the Authorization header or cookie.
   */
  @Get('me')
  @ApiOperation({ summary: 'Get current identity' })
  @ApiResponse({ status: 200, type: MeResponseDto })
  async getMe(@Req() request: FastifyRequest): Promise<MeResponseDto> {
    return this.authService.getMe(request);
  }
}
