export const ADMIN_READ_THROTTLE = {
  global: { limit: 600, ttl: 60_000 },
} as const;

export const CATALOG_READ_THROTTLE = {
  global: { limit: 300, ttl: 60_000 },
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
