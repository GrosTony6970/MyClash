import {
  Injectable,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { getConnectorClientId, getIdentity } from '../../common/auth/identity';
import type { McpCaller } from './mcp-server';
import { MCP_SCOPES, mcpUrls } from './mcp-urls';

/** The caller the guard puts on a request it lets through. */
type McpRequest = FastifyRequest & { mcpCaller?: McpCaller };

/**
 * The caller of a request the guard let through. A request it never passed has none, and that
 * throws: there is no caller to fall back on.
 */
export function mcpCallerOf(request: FastifyRequest): McpCaller {
  const caller = (request as McpRequest).mcpCaller;
  if (!caller) throw new Error('No MCP caller on this request: McpDoorGuard did not pass it.');
  return caller;
}

/**
 * The MCP door's sign-in check. It runs after AuthGuard and lets through one caller only: a Claude
 * connector token, sent as a Bearer, that AuthGuard verified (`claimed`, with its `client_id`).
 *
 * A login cookie never opens the door, so a browser cannot be driven into it from another site.
 * AuthGuard reads the Bearer before the cookie, so a `claimed` caller with a Bearer is the
 * Bearer's own account. Revocation lags up to the token's expiry: this is the local check, never
 * GoTrue (`getAuthUser` refuses a connector token on purpose).
 *
 * Anyone else gets 401 with the challenge Claude reads to start the sign-in (RFC 9728): where the
 * resource metadata is, and the scopes. A Bearer that is not a live connector token adds
 * `error="invalid_token"` (RFC 6750), so Claude renews or signs in again. The header goes on the
 * reply, and the exception filter writes the body.
 */
@Injectable()
export class McpDoorGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const bearer = hasBearer(request);
    const identity = getIdentity(request);
    const clientId = getConnectorClientId(request);
    if (bearer && identity.kind === 'claimed' && clientId) {
      (request as McpRequest).mcpCaller = {
        userId: identity.userId,
        email: identity.email,
        clientId,
      };
      return true;
    }
    const reply = context.switchToHttp().getResponse<FastifyReply>();
    reply.header('WWW-Authenticate', this.challenge(bearer));
    throw new UnauthorizedException(
      bearer ? 'The token is not a live MyClash connector token' : 'Connector token required',
    );
  }

  private challenge(invalidToken: boolean): string {
    const { resourceMetadata } = mcpUrls({
      DOMAIN: this.config.getOrThrow<string>('DOMAIN'),
      SUPABASE_URL: this.config.getOrThrow<string>('SUPABASE_URL'),
    });
    const params = [
      ...(invalidToken ? ['error="invalid_token"'] : []),
      `resource_metadata="${resourceMetadata}"`,
      `scope="${MCP_SCOPES.join(' ')}"`,
    ];
    return `Bearer ${params.join(', ')}`;
  }
}

function hasBearer(request: FastifyRequest): boolean {
  const header = request.headers['authorization'];
  return typeof header === 'string' && header.startsWith('Bearer ');
}
