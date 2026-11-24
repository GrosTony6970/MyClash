import { SetMetadata, type CustomDecorator, type ExecutionContext } from '@nestjs/common';
import { requestAccount } from './throttle-by-account';
import { isThrottleWhitelisted } from './throttle-whitelist';

/** Name of the account-keyed throttler that counts MCP requests (registered in AppModule). */
export const MCP_THROTTLER = 'mcp';

const THROTTLE_MCP = 'throttle:mcp';

/**
 * Opts a controller or a route into the MCP throttler: requests per minute per account. Every
 * person's Claude calls from Anthropic's few addresses, so a per-IP limit would let one busy person
 * stop everybody; this counts the account, in its own bucket. Every configured throttler runs on
 * every route; this one skips anything without the marker.
 */
export const ThrottleMcp = (): CustomDecorator => SetMetadata(THROTTLE_MCP, true);

export function skipMcpThrottle(context: ExecutionContext): boolean {
  // A per-throttler skipIf replaces the module-level one, so the whitelist is asked here too.
  if (isThrottleWhitelisted(context)) return true;
  // `McpDoor` marks the whole controller, so the class counts as well as the handler.
  const marked = [context.getHandler(), context.getClass()].some(
    (target) => Reflect.getMetadata(THROTTLE_MCP, target) === true,
  );
  if (!marked) return true;
  // No account: the door answers 401, and requests with no login must not share one bucket.
  return requestAccount(context.switchToHttp().getRequest()) === '';
}
