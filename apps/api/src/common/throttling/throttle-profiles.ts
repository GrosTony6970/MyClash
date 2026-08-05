export const ADMIN_READ_THROTTLE = {
  global: { limit: 600, ttl: 60_000 },
} as const;

export const CATALOG_READ_THROTTLE = {
  global: { limit: 300, ttl: 60_000 },
} as const;

/**
 * The three endpoints the public match page refetches when its realtime channel
 * is down: `GET matches/:id`, `matches/:id/exchanges`, `matches/:id/penalties`.
 *
 * Sized for a VENUE, not for a browser. Every phone on the hall's wifi shares
 * one public IP, and `req.ip` is the real client address (Fastify runs with
 * `trustProxy: 1`), so the whole room draws on ONE bucket. At the fallback's
 * fastest cadence that is 3 requests every 5s per spectator = 36/min: on the
 * global 120/min the fourth phone watching a live bout would start collecting
 * 429s. 600 puts the ceiling around sixteen, which is the difference between
 * "the scoreboard lags" and "the scoreboard stops for the room".
 *
 * Safe to raise because these are cheap indexed reads on already-public data —
 * the same reasoning as ADMIN_READ_THROTTLE, whose surfaces poll for the same
 * reason. Anything that WRITES stays on the global limit.
 */
export const PUBLIC_LIVE_READ_THROTTLE = {
  global: { limit: 600, ttl: 60_000 },
} as const;

export const AUTH_ACTION_THROTTLE = {
  global: { limit: 10, ttl: 3_600_000 },
} as const;

/**
 * Login attempts per hour per email address, shared across every email+password
 * login surface (see ThrottleByEmail).
 *
 * Complements AUTH_ACTION_THROTTLE rather than duplicating it: the per-IP limit
 * bounds one IP across all accounts, this bounds one account across all IPs.
 * Only the latter constrains distributed credential stuffing, where each source
 * IP stays comfortably under its own allowance.
 */
export const AUTH_EMAIL_THROTTLE = {
  limit: 10,
  ttl: 3_600_000,
} as const;

export const SIGNUP_ACTION_THROTTLE = {
  global: { limit: 5, ttl: 3_600_000 },
} as const;
