import type { ThrottlerModuleOptions } from '@nestjs/throttler';
import { AUTH_EMAIL_THROTTLER, authEmailTracker, skipAuthEmailThrottle } from './throttle-by-email';
import { AUTH_EMAIL_THROTTLE } from './throttle-profiles';
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
 *
 * IPs in THROTTLE_IP_WHITELIST skip both. Every limit keys off `req.ip`, which is
 * only meaningful because the Fastify adapter sets `trustProxy: 1` (see main.ts);
 * without it every client behind Traefik shares one bucket.
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
  ],
  skipIf: isThrottleWhitelisted,
};
