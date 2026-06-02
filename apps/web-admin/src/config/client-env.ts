/**
 * Read a NEXT_PUBLIC_* env var that the admin bundle requires to
 * boot. In production, throws at module-evaluation time when the
 * var is missing — surfaces config bugs (e.g. a forgotten
 * Dockerfile ARG) as a loud failure instead of a silent localhost
 * fallback that ships broken.
 *
 * In dev/test, returns `devFallback` so `pnpm dev` keeps working
 * without an explicit env file.
 */
export function requireClientEnv(name: string, devFallback: string): string {
  const value = process.env[name];
  if (value && value.length > 0) return value;
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      `[client-env] ${name} is required in production but was not set at build time. ` +
        `Check that apps/web-admin/Dockerfile declares ARG ${name} and the docker-compose build passes a value.`,
    );
  }
  return devFallback;
}

/**
 * Optional NEXT_PUBLIC_* (e.g. Sentry DSN). Returns undefined when
 * unset, regardless of NODE_ENV — telemetry-style vars should not
 * block the app from booting.
 */
export function optionalClientEnv(name: string): string | undefined {
  const value = process.env[name];
  return value && value.length > 0 ? value : undefined;
}
