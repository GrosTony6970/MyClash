import { SetMetadata, type CustomDecorator, type ExecutionContext } from '@nestjs/common';
import { requestAccount } from './throttle-by-account';
import { isThrottleWhitelisted } from './throttle-whitelist';

/** Name of the account-keyed throttler that counts FightBook QR codes minted (in AppModule). */
export const FIGHTBOOK_QR_MINT_THROTTLER = 'fightbook-qr-mint';

const THROTTLE_FIGHTBOOK_QR_MINT = 'throttle:fightbook-qr-mint';

/**
 * Opts a route into the FightBook QR-mint throttler: codes minted per hour per account (slice 5,
 * Decision 11). Keyed on the account like `ThrottleFightBookAsk`, in a bucket of its own. Every
 * configured throttler runs on every route; this one skips anything without the marker.
 */
export const ThrottleFightBookQrMint = (): CustomDecorator =>
  SetMetadata(THROTTLE_FIGHTBOOK_QR_MINT, true);

export function skipFightBookQrMintThrottle(context: ExecutionContext): boolean {
  // A per-throttler skipIf replaces the module-level one, so the whitelist is asked here too.
  if (isThrottleWhitelisted(context)) return true;
  if (Reflect.getMetadata(THROTTLE_FIGHTBOOK_QR_MINT, context.getHandler()) !== true) return true;
  // No account: the route answers 401, and requests with no login must not share one bucket.
  return requestAccount(context.switchToHttp().getRequest()) === '';
}
