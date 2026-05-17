export const ADMIN_READ_THROTTLE = {
  global: { limit: 600, ttl: 60_000 },
} as const;

export const CATALOG_READ_THROTTLE = {
  global: { limit: 300, ttl: 60_000 },
} as const;

export const AUTH_ACTION_THROTTLE = {
  global: { limit: 10, ttl: 3_600_000 },
} as const;

export const SIGNUP_ACTION_THROTTLE = {
  global: { limit: 5, ttl: 3_600_000 },
} as const;
