import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { SIGNUP_ACTION_THROTTLE } from '../../common/throttling/throttle-profiles';
import {
  ADMIN_LOCKDOWN_CODE,
  CLUB_NOT_MADE_CODE,
  READ_ONLY_MODE_CODE,
  SIGNUP_REFUSED_PARAM,
  SIGNUPS_DISABLED_CODE,
} from '@myclash/types';
import { captureApiException } from '../../common/observability/sentry';
import { OperationalUnavailableException } from '../../common/operational-exception';
import { OnboardingService } from '../organizations/onboarding.service';
import { clubPage, type SignupClub } from '../organizations/signup-club';
import { CheckSlugDto, SignupDto, signupClubSchema } from '../organizations/dto/signup.dto';
import { Public } from '../../common/auth/public.decorator';
import { requestAcceptanceContext } from '../../common/legal/acceptance-context';
import { LegalAcceptanceService } from '../privacy/legal-acceptance.service';
import { AuthService } from './auth.service';
import { refusedLinkOrThrow } from './refused-link';

// Pre-session bootstrap: org signup, slug availability, signup callback.
// The caller has no identity yet by definition.
@Public()
@ApiTags('auth')
@Controller('auth')
export class SignupController {
  private readonly logger = new Logger(SignupController.name);

  constructor(
    private readonly onboarding: OnboardingService,
    private readonly auth: AuthService,
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
    await this.onboarding.assertSignupsOpen();
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
   * Called after the magic-link signup flow. The mailed link lands here with
   * its code and the org creation payload in query params. We exchange the code,
   * create the org, and redirect to the org dashboard. A link that signs nobody
   * in, and a club that cannot be made, send her to the sign-up page with the
   * reason (operator rulings 362, 363): a browser reads no error body.
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
    // Both checks run BEFORE the link is spent (operator ruling 305). A link
    // edited by hand made a club under any name. And while sign-ups are off,
    // or read-only mode is on (ruling 341), she goes to the sign-up page, which
    // says so: the same mail works again once they are back on.
    if (!signupClubSchema.safeParse({ orgName, orgSlug }).success) {
      throw new BadRequestException('This sign-up link names no valid organization');
    }
    const refused = await this.refusedBeforeTheSpend();
    if (refused) return this.backToSignup(reply, refused);

    // The club is made for the account the LINK proved (operator ruling 299). The
    // old door asked `/me` about the cookies the browser SENT: a new person sent
    // none and got no club, and a browser signed in as somebody else got the club
    // made for that account. A link that signs nobody in sends her to the sign-up
    // page with the reason (rulings 360, 362): her browser cannot read a 401.
    const user = await this.auth.signInFromSignupLink(tokenHash, reply).catch(refusedLinkOrThrow);
    if (typeof user === 'string') return this.backToSignup(reply, user);
    const made = await this.clubOf(user.id, orgName, orgSlug);
    if (!made) return this.backToSignup(reply, CLUB_NOT_MADE_CODE);
    // The account exists only now, which is why the acceptance is recorded
    // here rather than when the link was requested. Not asserted: the
    // versions were already checked at /auth/signup, and a policy revised
    // between sending the mail and clicking it must not strand a user
    // mid-signup on a redirect they cannot answer. A version that no longer
    // matches simply shows up in `pendingLegal` and the banner asks again.
    await this.recordCallbackAcceptance(user.id, acceptedTerms, acceptedPrivacy, _req);

    // The club that was MADE (operator ruling 304): its address is another one
    // than `orgSlug` when somebody took hers between her request and her click.
    // Or the club her account owned already (ruling 369): its page says so.
    void reply.redirect(clubPage(made));
  }

  /** The sign-up page, which says the reason in her language. */
  private backToSignup(reply: FastifyReply, reason: string): void {
    void reply.redirect(`/signup?${SIGNUP_REFUSED_PARAM}=${reason}`);
  }

  /**
   * The club of the account, made here or owned before, or null when it cannot
   * be written (operator ruling 363). The link is spent and she is signed in: the
   * door has no 5xx to report, so the fault is logged and reported here. The
   * account stands, and a second sign-up by email link mails a link that makes
   * the club. The password choice refuses her address: it holds an account now.
   */
  private async clubOf(
    userId: string,
    orgName: string,
    orgSlug: string,
  ): Promise<SignupClub | null> {
    try {
      return await this.onboarding.completeSignupAfterMagicLink(userId, orgName, orgSlug);
    } catch (fault) {
      this.logger.error(`No club was made for account ${userId} at the sign-up link`, fault);
      captureApiException(fault, { door: 'auth/signup-callback' });
      return null;
    }
  }

  /**
   * Why the mailed link is not spent now, as the sign-up page reads it, or null.
   *
   * The maintenance lockdown too (operator ruling 324): the sign-in would refuse
   * her AFTER the link is spent, with a 503 her browser cannot read, and leave
   * an account with no club. Nobody who signs up is platform staff.
   */
  private async refusedBeforeTheSpend(): Promise<string | null> {
    const closedBy = await this.signupsClosedBy();
    if (closedBy) return closedBy;
    return (await this.auth.isAdminLockdownEnabled()) ? ADMIN_LOCKDOWN_CODE : null;
  }

  /**
   * The code of the switch that closes sign-ups, or null: "sign-ups off", or read-only
   * mode (operator ruling 341). A switch's own refusal is an answer here; any other
   * fault still throws.
   */
  private async signupsClosedBy(): Promise<string | null> {
    try {
      await this.onboarding.assertSignupsOpen();
      return null;
    } catch (refusal) {
      if (!(refusal instanceof OperationalUnavailableException)) throw refusal;
      const { code } = refusal.getResponse() as { code?: unknown };
      return code === READ_ONLY_MODE_CODE ? READ_ONLY_MODE_CODE : SIGNUPS_DISABLED_CODE;
    }
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
