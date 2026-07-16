import type { ExecutionContext } from '@nestjs/common';

/**
 * Client IPs exempt from every rate limit — e.g. the organizer's own network
 * running bulk imports or the demo-population E2E.
 *
 * Configured only via THROTTLE_IP_WHITELIST (comma-separated). Deliberately not
 * hardcoded: this repo is public, so a literal would publish both a personal
 * address and the precise list of IPs that bypass login throttling.
 *
 * Resolved per call rather than at module load so it still picks up values that
 * ConfigModule reads out of a .env file after this module is imported (in prod
 * the value arrives as a real container env var and either would work).
 */
let cachedRaw: string | undefined;
let cached: Set<string> = new Set();

export function throttleWhitelist(): ReadonlySet<string> {
  const raw = process.env.THROTTLE_IP_WHITELIST ?? '';
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cached = new Set(
      raw
        .split(',')
        .map((ip) => ip.trim())
        .filter(Boolean),
    );
  }
  return cached;
}

/**
 * Relies on `req.ip`, which is trustworthy because the Fastify adapter is
 * configured with `trustProxy: 1` (see main.ts) — it resolves to the address
 * Traefik observed, not to a client-supplied X-Forwarded-For entry.
 */
export function isThrottleWhitelisted(context: ExecutionContext): boolean {
  const allowed = throttleWhitelist();
  if (allowed.size === 0) return false;
  const req = context.switchToHttp().getRequest<{ ip?: string }>();
  return allowed.has(req.ip ?? '');
}
