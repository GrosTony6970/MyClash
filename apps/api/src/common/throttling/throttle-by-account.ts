import { SetMetadata, type CustomDecorator, type ExecutionContext } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { verifyAccessTokenLocally } from '../../modules/supabase/supabase.service';
import { isThrottleWhitelisted } from './throttle-whitelist';

/** Name of the account-keyed throttler registered in AppModule. */
export const AUTH_ACCOUNT_THROTTLER = 'auth-account';

const THROTTLE_BY_ACCOUNT = 'throttle:by-account';

/**
 * Opts a route into the account-keyed throttler: a door that checks the CURRENT
 * password of the signed-in account (operator ruling 359). Every configured
 * throttler runs on every route, so the throttler skips anything without this
 * marker.
 */
export const ThrottleByAccount = (): CustomDecorator => SetMetadata(THROTTLE_BY_ACCOUNT, true);

type Carrier = { headers?: Record<string, unknown>; cookies?: Record<string, string> };

/**
 * The account of the login a request carries, or ''.
 *
 * This guard runs BEFORE AuthGuard, so nobody has read the login yet: it is
 * read here, from the same two places, and its signature is checked the way
 * AuthGuard checks it. A login somebody made up, with a real account's id in
 * it, reaches no password check and must not spend that account's tries. An
 * expired login is no account either: the door answers 401, the client renews
 * it, and the second send is the one counted. With no SUPABASE_JWT_SECRET no
 * login can be checked and nothing is counted: production cannot boot so.
 *
 * Never `req.ip`: a whole venue shares one address, and the person guessing a
 * password at an open session is on it too.
 */
function requestAccount(req: Carrier): string {
  const header = req.headers?.['authorization'];
  const token =
    typeof header === 'string' && header.startsWith('Bearer ')
      ? header.slice(7)
      : req.cookies?.['sb-access-token'];
  const secret = process.env.SUPABASE_JWT_SECRET;
  if (!token || !secret) return '';
  return verifyAccessTokenLocally(token, secret)?.id ?? '';
}

/** Hashed so the in-memory throttler store never holds a raw account id. */
export function authAccountTracker(req: Record<string, unknown>): string {
  return createHash('sha256').update(requestAccount(req)).digest('hex');
}

export function skipAuthAccountThrottle(context: ExecutionContext): boolean {
  // A per-throttler skipIf REPLACES the module-level one rather than composing
  // with it, so the whitelist check has to be repeated here.
  if (isThrottleWhitelisted(context)) return true;
  if (Reflect.getMetadata(THROTTLE_BY_ACCOUNT, context.getHandler()) !== true) return true;
  // No account to key on: the door answers 401, and requests with no login
  // must not share one bucket.
  return requestAccount(context.switchToHttp().getRequest<Carrier>()) === '';
}
