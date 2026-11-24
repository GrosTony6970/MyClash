import { SetMetadata, type CustomDecorator, type ExecutionContext } from '@nestjs/common';
import { requestAccount } from './throttle-by-account';
import { isThrottleWhitelisted } from './throttle-whitelist';

/** Name of the account-keyed throttler that counts MCP requests (registered in AppModule). */
export const MCP_THROTTLER = 'mcp';

/** Name of the address-keyed throttler that counts MCP requests with no login. */
export const MCP_ANON_THROTTLER = 'mcp-anon';

const THROTTLE_MCP = 'throttle:mcp';

/**
 * Opts a controller or a route into the two MCP throttlers. A request with a login counts against
 * its account (`mcp`): every person's Claude calls from Anthropic's few addresses, so a per-IP
 * limit would let one busy person stop everybody. A request with no login has no account, and
 * counts against its address instead (`mcp-anon`), so the 401s cannot be asked without end. Every
 * configured throttler runs on every route; these two skip anything without the marker.
 */
export const ThrottleMcp = (): CustomDecorator => SetMetadata(THROTTLE_MCP, true);

/** `McpDoor` marks the whole controller, so the class counts as well as the handler. */
function isMcpRoute(context: ExecutionContext): boolean {
  return [context.getHandler(), context.getClass()].some(
    (target) => Reflect.getMetadata(THROTTLE_MCP, target) === true,
  );
}

const hasAccount = (context: ExecutionContext): boolean =>
  requestAccount(context.switchToHttp().getRequest()) !== '';

export function skipMcpThrottle(context: ExecutionContext): boolean {
  // A per-throttler skipIf replaces the module-level one, so the whitelist is asked here too.
  if (isThrottleWhitelisted(context)) return true;
  if (!isMcpRoute(context)) return true;
  // No account: `mcp-anon` counts it, by address; such requests must not share one bucket here.
  return !hasAccount(context);
}

const hasBearer = (context: ExecutionContext): boolean => {
  const header = context.switchToHttp().getRequest<{ headers?: Record<string, unknown> }>()
    .headers?.authorization;
  return typeof header === 'string' && header.startsWith('Bearer ');
};

export function skipMcpAnonThrottle(context: ExecutionContext): boolean {
  if (isThrottleWhitelisted(context)) return true;
  if (!isMcpRoute(context)) return true;
  // A login counts against its account (`mcp`), never against the address Claude shares. A Bearer
  // that is expired or invalid has no account either, but it must not be counted here: a 429
  // would replace the `invalid_token` challenge Claude refreshes on.
  return hasAccount(context) || hasBearer(context);
}
