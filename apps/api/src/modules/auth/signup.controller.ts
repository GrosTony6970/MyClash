import {
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
import {
  AUTH_ACTION_THROTTLE,
  SIGNUP_ACTION_THROTTLE,
} from '../../common/throttling/throttle-profiles';
import { CLUB_NOT_MADE_CODE } from '@myclash/types';
import { adminLockdownRefusal } from '../../common/admin-lockdown';
import { captureApiException } from '../../common/observability/sentry';
import { OnboardingService } from '../organizations/onboarding.service';
import { clubPage, type SignupClub } from '../organizations/signup-club';
import { CheckSlugDto, SignupChoosePasswordDto, SignupDto } from '../organizations/dto/signup.dto';
import { Public } from '../../common/auth/public.decorator';
import { requestAcceptanceContext } from '../../common/legal/acceptance-context';
import { LegalAcceptanceService } from '../privacy/legal-acceptance.service';
import { AuthService } from './auth.service';
import { uncheckedLinkOrThrow } from './refused-link';

// Pre-session bootstrap: org signup, slug availability, the sign-up's choose-password door.
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
   * This endpoint is called on step 2 submission (org name + slug). It mails
   * the link that opens "choose your password"; no password is taken here.
   *
   * Rate limited: 5 per hour per IP.
   */
  @Post('signup')
  @HttpCode(HttpStatus.CREATED)
  @Throttle(SIGNUP_ACTION_THROTTLE)
  @ApiOperation({ summary: 'Organizer self-service signup' })
  @ApiResponse({ status: 201, description: 'Signup link mailed' })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 409, description: 'Slug already taken or reserved' })
  @ApiResponse({ status: 429, description: 'Rate limit exceeded' })
  async signup(@Body() dto: SignupDto) {
    await this.onboarding.assertSignupsOpen();
    return this.onboarding.signup(dto);
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
   * POST /api/v1/auth/signup-choose-password
   *
   * The organiser's "choose your password" page (ruling "Pre-takeover"): the
   * sign-up mail's code, the password, and the club the link carries. The club
   * is checked by the DTO, and the switches are read, BEFORE the code is spent
   * (ruling 305): the same mail works again once they are back on. Then the
   * one owner spends the code, checks the lockdown again, writes the password
   * and signs her in (`choosePasswordFromCode`), and the club is made for the
   * account the CODE names (ruling 299), never the one the browser sent.
   */
  @Post('signup-choose-password')
  @HttpCode(HttpStatus.OK)
  @Throttle(AUTH_ACTION_THROTTLE)
  @ApiOperation({ summary: 'Confirm an organizer address, choose its password, make the club' })
  @ApiResponse({
    status: 200,
    description:
      '`saved`, `signedIn` and `next` (the club made), or `code`: `link_unchecked`, or `club_not_made` with `saved` and `signedIn`',
  })
  @ApiResponse({ status: 400, description: 'Weak password, or no valid club in the link' })
  @ApiResponse({
    status: 401,
    description: '`code: link_expired`: the link was used or is too old',
  })
  @ApiResponse({
    status: 503,
    description: '`code`: `signups_disabled`, `read_only_mode` or `admin_lockdown`',
  })
  async signupChoosePassword(
    @Body() dto: SignupChoosePasswordDto,
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    await this.assertOpenBeforeTheSpend();
    const chosen = await this.auth
      .choosePasswordFromCode(dto.token_hash, dto.password, reply, { lockdown: true })
      .catch(uncheckedLinkOrThrow);
    if (typeof chosen === 'string') {
      void reply.send({ code: chosen });
      return;
    }
    const { user, saved, signedIn } = chosen;
    const made = await this.clubOf(user.id, dto.orgName, dto.orgSlug);
    if (!made) {
      void reply.send({ code: CLUB_NOT_MADE_CODE, saved, signedIn });
      return;
    }
    // The account exists only now. Not asserted: the versions were checked at
    // /auth/signup, and a policy revised between the mail and the click must not
    // strand her; a version that no longer matches shows up in `pendingLegal`.
    await this.legal.recordForUser(
      user.id,
      { terms: dto.acceptedTerms, privacy: dto.acceptedPrivacy },
      requestAcceptanceContext(request),
    );
    // The club that was MADE (ruling 304), or the one her account owned (ruling 369).
    void reply.send({ saved, signedIn, next: clubPage(made) });
  }

  /**
   * The club of the account, made here or owned before, or null when it cannot
   * be written (operator ruling 363). The code is spent and she is signed in: the
   * fault is logged and reported here, and the page says the club was not made.
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
      captureApiException(fault, { door: 'auth/signup-choose-password' });
      return null;
    }
  }

  /**
   * The switches that keep the sign-up's code unspent, each refused with its own
   * coded 503: "sign-ups off" and read-only mode (rulings 305, 341), then the
   * maintenance lockdown (ruling 324): nobody who signs up is platform staff.
   */
  private async assertOpenBeforeTheSpend(): Promise<void> {
    await this.onboarding.assertSignupsOpen();
    if (await this.auth.isAdminLockdownEnabled()) throw adminLockdownRefusal();
  }
}
