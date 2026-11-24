import {
  ForbiddenException,
  GoneException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ConsentAction, ConsentAnswer, ConsentView } from '@myclash/types';
import { OperationalUnavailableException } from '../../common/operational-exception';
import { callGoTrueAsPerson } from './gotrue-as-person';
import { describeCallback, hostOf, isClaudeCallback, redirectsToClaude } from './claude-callbacks';

/** GoTrue's pending request, as the person is asked about it. */
interface Details {
  kind: 'details';
  redirectUri: string;
  clientName: string;
  scopes: string[];
}

/** The person already agreed to this client for these scopes: GoTrue answers with the code. */
interface AutoApproved {
  kind: 'auto-approved';
  redirectUrl: string;
}

const EXPIRED = { kind: 'expired' } as const;

/**
 * GoTrue's ids are letters, digits and dashes. Anything else never reaches it: Fastify decodes
 * `%2F` in a path parameter, and the id goes into the path of an internal call.
 */
const AUTHORIZATION_ID = /^[A-Za-z0-9_-]{1,128}$/u;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The consent page's server side. The page cannot read the httpOnly login cookie, so it asks this
 * API, which asks GoTrue with the person's own login and lets only Claude's callbacks through
 * (`claude-callbacks.ts`).
 *
 * GoTrue answers 404 for a request that expired or belongs to someone else, and 400 for one no
 * longer pending: both read as expired, since the person's only move is to start again from
 * Claude. Any answer this file cannot read is a 503 — never a refusal or an approval on a guess.
 */
@Injectable()
export class OAuthConsentService {
  private readonly logger = new Logger(OAuthConsentService.name);

  constructor(private readonly config: ConfigService) {}

  async view(authorizationId: string, login: string): Promise<ConsentView> {
    if (!AUTHORIZATION_ID.test(authorizationId)) return EXPIRED;
    const pending = await this.details(authorizationId, login);
    if (pending.kind === 'expired') return EXPIRED;
    if (pending.kind === 'auto-approved') {
      return redirectsToClaude(pending.redirectUrl)
        ? { kind: 'go', redirectUrl: pending.redirectUrl }
        : this.refused(pending.redirectUrl);
    }
    const callback = describeCallback(pending.redirectUri);
    if (!callback) return this.refused(pending.redirectUri);
    return { kind: 'ask', clientName: pending.clientName, callback, scopes: pending.scopes };
  }

  /**
   * The person's answer. Throws `GoneException('expired')` for a request that is gone, and
   * `ForbiddenException('not_claude')` for any redirect outside the list.
   *
   * Approve reads the details again first: the page's earlier read proves nothing about this
   * request. A client outside the list is denied at GoTrue, so its request cannot be approved
   * later from another tab. Deny goes straight to GoTrue; a request that is no longer pending
   * then reads as expired.
   */
  async answer(
    authorizationId: string,
    login: string,
    action: ConsentAction,
  ): Promise<ConsentAnswer> {
    if (!AUTHORIZATION_ID.test(authorizationId)) throw new GoneException('expired');
    if (action === 'deny') return this.toClaude(await this.consent(authorizationId, login, 'deny'));

    const pending = await this.details(authorizationId, login);
    if (pending.kind === 'expired') throw new GoneException('expired');
    if (pending.kind === 'auto-approved') return this.toClaude(pending.redirectUrl);
    if (!isClaudeCallback(pending.redirectUri)) {
      this.refused(pending.redirectUri);
      await this.consent(authorizationId, login, 'deny');
      throw new ForbiddenException('not_claude');
    }
    return this.toClaude(await this.consent(authorizationId, login, 'approve'));
  }

  private toClaude(redirectUrl: string): ConsentAnswer {
    if (redirectsToClaude(redirectUrl)) return { redirectUrl };
    this.refused(redirectUrl);
    throw new ForbiddenException('not_claude');
  }

  /** The wall's trace: a client outside the list is the phishing this file exists to stop. */
  private refused(uri: string): ConsentView {
    const redirectHost = hostOf(uri);
    this.logger.warn(`Refused an OAuth redirect outside Claude's callbacks, to ${redirectHost}`);
    return { kind: 'refused', reason: 'not-claude', redirectHost };
  }

  private async details(
    authorizationId: string,
    login: string,
  ): Promise<Details | AutoApproved | typeof EXPIRED> {
    const body = await this.ask(`/oauth/authorizations/${authorizationId}`, login);
    if (!body) return EXPIRED;
    // GoTrue's auto-approved answer carries `redirect_url` and nothing else.
    if (typeof body['redirect_url'] === 'string') {
      return { kind: 'auto-approved', redirectUrl: body['redirect_url'] };
    }
    const client = body['client'];
    const { redirect_uri: redirectUri, scope } = body;
    if (
      typeof redirectUri !== 'string' ||
      typeof scope !== 'string' ||
      !isRecord(client) ||
      typeof client['name'] !== 'string'
    ) {
      throw this.unavailable('the authorization details have an unexpected shape');
    }
    return {
      kind: 'details',
      redirectUri,
      clientName: client['name'],
      scopes: scope.split(/\s+/u).filter(Boolean),
    };
  }

  private async consent(
    authorizationId: string,
    login: string,
    action: ConsentAction,
  ): Promise<string> {
    const body = await this.ask(`/oauth/authorizations/${authorizationId}/consent`, login, {
      action,
    });
    if (!body) throw new GoneException('expired');
    const redirectUrl = body['redirect_url'];
    if (typeof redirectUrl !== 'string') {
      throw this.unavailable('the consent answer has no redirect_url');
    }
    return redirectUrl;
  }

  /** One call to GoTrue with the person's login; null when the request is gone (404 or 400). */
  private async ask(
    path: string,
    login: string,
    payload?: { action: ConsentAction },
  ): Promise<Record<string, unknown> | null> {
    const response = await callGoTrueAsPerson(
      this.config,
      { path, login, method: payload ? 'POST' : 'GET', body: payload },
      (why) => this.unavailable(why),
    );

    if (response.status === 404 || response.status === 400) return null;
    // The page renews the login on a 401 and asks again.
    if (response.status === 401) throw new UnauthorizedException('Invalid or expired session');
    if (!response.ok) throw this.unavailable(`status ${response.status}`);

    const body: unknown = await response.json().catch(() => null);
    if (!isRecord(body)) throw this.unavailable('an answer that is no JSON object');
    return body;
  }

  private unavailable(why: string): OperationalUnavailableException {
    this.logger.warn(`GoTrue gave the consent page no usable answer: ${why}`);
    return new OperationalUnavailableException({
      code: 'consent_unavailable',
      message: 'The sign-in server did not answer. Try again in a moment.',
    });
  }
}
