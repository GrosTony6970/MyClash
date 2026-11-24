import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Req } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { ConsentAnswer, ConsentView } from '@myclash/types';
import type { FastifyRequest } from 'fastify';
import { SupabaseService } from '../supabase/supabase.service';
import { AnswerConsentDto } from './dto';
import { signedInLogin } from './gotrue-as-person';
import { OAuthConsentService } from './oauth-consent.service';

/**
 * The consent page's API. GoTrue sends the person's browser to the page with an
 * `authorization_id`; the page cannot read the httpOnly login cookie, so it calls these routes on
 * the same site, and they call GoTrue with the person's own login.
 *
 * A `me` route: the signed-in person's own consent. AuthGuard refuses a connector token on every route but the MCP door,
 * so the login here is always the person's browser login. GoTrue binds the request to that
 * login and answers 404 to anyone else.
 */
@ApiTags('mcp')
@Controller('me/oauth-consent')
export class OAuthConsentController {
  constructor(
    private readonly consent: OAuthConsentService,
    private readonly supabase: SupabaseService,
  ) {}

  @Get(':authorizationId')
  @ApiOperation({ summary: 'What a Claude connection request asks of the signed-in person' })
  @ApiResponse({ status: 200, description: 'ask, refused (not Claude), go, or expired' })
  @ApiResponse({ status: 401, description: 'Signed out, or the login ended' })
  @ApiResponse({ status: 503, description: 'The sign-in server gave no usable answer' })
  async view(
    @Param('authorizationId') authorizationId: string,
    @Req() req: FastifyRequest,
  ): Promise<ConsentView> {
    return this.consent.view(authorizationId, await this.login(req));
  }

  @Post(':authorizationId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Approve or deny a Claude connection request; Claude's redirect" })
  @ApiResponse({ status: 200, description: 'The redirect back to Claude' })
  @ApiResponse({ status: 401, description: 'Signed out, or the login ended' })
  @ApiResponse({ status: 403, description: "not_claude: the redirect is not one of Claude's" })
  @ApiResponse({ status: 410, description: 'expired: the request is gone; start again' })
  @ApiResponse({ status: 503, description: 'The sign-in server gave no usable answer' })
  async answer(
    @Param('authorizationId') authorizationId: string,
    @Body() dto: AnswerConsentDto,
    @Req() req: FastifyRequest,
  ): Promise<ConsentAnswer> {
    return this.consent.answer(authorizationId, await this.login(req), dto.action);
  }

  private login(req: FastifyRequest): Promise<string> {
    return signedInLogin(req, this.supabase);
  }
}
