import type { ThrottlerModuleOptions } from '@nestjs/throttler';
import {
  AUTH_ACCOUNT_THROTTLER,
  authAccountTracker,
  skipAuthAccountThrottle,
} from './throttle-by-account';
import { AUTH_EMAIL_THROTTLER, authEmailTracker, skipAuthEmailThrottle } from './throttle-by-email';
import { AUTH_ACCOUNT_THROTTLE, AUTH_EMAIL_THROTTLE } from './throttle-profiles';
import { isThrottleWhitelisted } from './throttle-whitelist';

/**
 * The app's rate-limiting configuration, consumed by AppModule via
 * `ThrottlerModule.forRoot(throttlerOptions)`.
 *
 * `global`     — 120 req/min per client IP. Heavy read-only admin/catalog routes
 *                and sensitive auth actions override it per route with @Throttle
 *                (see throttle-profiles).
 * `auth-email` — login attempts per hour per email address, on routes marked
 *                @ThrottleByEmail. The per-IP limit bounds one IP across all
 *                accounts; this bounds one account across all IPs, which is the
 *                only thing that constrains distributed credential stuffing.
 * `auth-account` — checks of a current password per hour per signed-in account,
 *                on routes marked @ThrottleByAccount (ruling 359). Keyed on the
 *                account of the request's login, never on `req.ip`.
 *
 * The staff pad's PIN sign-in is not a throttler: a throttler counts a request
 * before its handler, and only a WRONG PIN may count there (operator, O3).
 * `@ThrottleByStaffAccount` is an interceptor (throttle-by-staff-account.ts).
 *
 * IPs in THROTTLE_IP_WHITELIST skip all three. The `global` limit keys off
 * `req.ip`, which is only meaningful because the Fastify adapter trusts the
 * one local proxy (trust-proxy.ts); without it every client behind Traefik
 * shares one bucket.
 *
 * Extracted from AppModule so the wiring is testable without booting the whole
 * app graph (see throttler-options.test.ts).
 */
export const throttlerOptions: ThrottlerModuleOptions = {
  throttlers: [
    {
      name: 'global',
      ttl: 60_000, // 1 minute window
      limit: 120,
    },
    {
      name: AUTH_EMAIL_THROTTLER,
      ttl: AUTH_EMAIL_THROTTLE.ttl,
      limit: AUTH_EMAIL_THROTTLE.limit,
      getTracker: authEmailTracker,
      // One bucket per address across every login route: the default key
      // generator mixes in the handler name, which would hand the same address a
      // fresh allowance on each surface.
      generateKey: (_context, tracker) => `${AUTH_EMAIL_THROTTLER}:${tracker}`,
      skipIf: skipAuthEmailThrottle,
    },
    {
      name: AUTH_ACCOUNT_THROTTLER,
      ttl: AUTH_ACCOUNT_THROTTLE.ttl,
      limit: AUTH_ACCOUNT_THROTTLE.limit,
      getTracker: authAccountTracker,
      // One bucket per account across both doors, as for auth-email above.
      generateKey: (_context, tracker) => `${AUTH_ACCOUNT_THROTTLER}:${tracker}`,
      skipIf: skipAuthAccountThrottle,
    },
  ],
  skipIf: isThrottleWhitelisted,
};
