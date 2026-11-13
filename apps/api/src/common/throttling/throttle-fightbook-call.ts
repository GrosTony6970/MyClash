import { SetMetadata, type CustomDecorator, type ExecutionContext } from '@nestjs/common';
import { requestAccount } from './throttle-by-account';
import { isThrottleWhitelisted } from './throttle-whitelist';

/** Name of the account-keyed throttler that counts FightBook open calls posted (in AppModule). */
export const FIGHTBOOK_CALL_THROTTLER = 'fightbook-call';

const THROTTLE_FIGHTBOOK_CALL = 'throttle:fightbook-call';

/**
 * Opts a route into the FightBook open-call throttler: calls posted per hour per account (slice 5,
 * Ruling L). Keyed on the account like `ThrottleFightBookAsk`, in a bucket of its own: the asks'
 * key ignores the handler, so sharing it would let twenty asks stop a post. Every configured
 * throttler runs on every route; this one skips anything without the marker.
 */
export const ThrottleFightBookCall = (): CustomDecorator =>
  SetMetadata(THROTTLE_FIGHTBOOK_CALL, true);

export function skipFightBookCallThrottle(context: ExecutionContext): boolean {
  // A per-throttler skipIf replaces the module-level one, so the whitelist is asked here too.
  if (isThrottleWhitelisted(context)) return true;
  if (Reflect.getMetadata(THROTTLE_FIGHTBOOK_CALL, context.getHandler()) !== true) return true;
  // No account: the route answers 401, and requests with no login must not share one bucket.
  return requestAccount(context.switchToHttp().getRequest()) === '';
}
