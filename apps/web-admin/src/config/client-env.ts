/**
 * Validate that a NEXT_PUBLIC_* env var that the admin bundle
 * requires to boot is actually set in the current build. When the
 * value is missing in production, logs a loud console.error
 * carrying the var name + Dockerfile guidance, AND returns
 * `devFallback` so the page still renders.
 *
 * IMPORTANT — call site pattern. Pass the result of
 * `process.env.NEXT_PUBLIC_FOO` as the first argument (direct
 * literal property access). DO NOT call this helper with the name
 * as the only argument:
 *
 *   ✗ const u = requireClientEnv('NEXT_PUBLIC_FOO', 'fallback')
 *   ✓ const u = requireClientEnv(
 *       process.env.NEXT_PUBLIC_FOO,
 *       'NEXT_PUBLIC_FOO',
 *       'fallback',
 *     )
 *
 * Why: Next.js statically inlines `process.env.NEXT_PUBLIC_FOO`
 * (direct property access) at build time, replacing it with the
 * actual value. Dynamic lookups like `process.env[name]` where
 * `name` is a runtime variable are NOT inlined — the prod browser
 * bundle would always see `undefined`. The previous shape of this
 * helper used a dynamic lookup and silently degraded every prod
 * call to the throw branch even when the build arg was set
 * correctly. Operator hit the resulting "Something went wrong"
 * error boundary on /pools and /bracket on 2026-06-02.
 *
 * Why log + fallback instead of throw: throwing inside a client
 * component nukes the whole page via the React error boundary
 * with no diagnostic visible to the user, and hitting "Try again"
 * re-mounts the same module and throws again. Loud-log +
 * fallback keeps the page running while making the
 * misconfiguration visible in DevTools / Sentry.
 *
 * In dev/test (no NODE_ENV=production), missing vars silently
 * fall back to `devFallback` so `pnpm dev` keeps working.
 */
export function requireClientEnv(
  value: string | undefined,
  name: string,
  devFallback: string,
): string {
  if (value && value.length > 0) return value;
  if (process.env.NODE_ENV === 'production') {
    console.error(
      `[client-env] ${name} is required in production but was not set at build time. ` +
        `Check that apps/web-admin/Dockerfile declares ARG ${name} and the docker-compose build passes a value. ` +
        `Falling back to '${devFallback}' for now — features depending on this var will not work until the next rebuild.`,
    );
  }
  return devFallback;
}

/**
 * Optional NEXT_PUBLIC_* (e.g. Sentry DSN). Returns undefined when
 * unset, regardless of NODE_ENV — telemetry-style vars should not
 * block the app from booting. Same call-site rule: pass
 * `process.env.NEXT_PUBLIC_FOO`, not the name string.
 */
export function optionalClientEnv(value: string | undefined): string | undefined {
  return value && value.length > 0 ? value : undefined;
}
