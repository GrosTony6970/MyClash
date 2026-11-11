import { SetMetadata, type CustomDecorator, type ExecutionContext } from '@nestjs/common';
import { requestAccount } from './throttle-by-account';
import { isThrottleWhitelisted } from './throttle-whitelist';

/** Name of the account-keyed throttler that counts FightBook asks (registered in AppModule). */
export const FIGHTBOOK_ASK_THROTTLER = 'fightbook-ask';

const THROTTLE_FIGHTBOOK_ASK = 'throttle:fightbook-ask';

/**
 * Opts a route into the FightBook ask throttler: spar requests per hour per account. Keyed on the
 * account like `ThrottleByAccount` (a venue shares one address), with its own bucket so asks never
 * spend password tries. Every configured throttler runs on every route; this one skips anything
 * without the marker.
 */
export const ThrottleFightBookAsk = (): CustomDecorator =>
  SetMetadata(THROTTLE_FIGHTBOOK_ASK, true);

export function skipFightBookAskThrottle(context: ExecutionContext): boolean {
  // A per-throttler skipIf replaces the module-level one, so the whitelist is asked here too.
  if (isThrottleWhitelisted(context)) return true;
  if (Reflect.getMetadata(THROTTLE_FIGHTBOOK_ASK, context.getHandler()) !== true) return true;
  // No account: the route answers 401, and requests with no login must not share one bucket.
  return requestAccount(context.switchToHttp().getRequest()) === '';
}
