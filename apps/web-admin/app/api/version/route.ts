/**
 * GET /api/version — what this container is actually serving.
 *
 * The gap it closes: `GET /api/v1/version` answers for the API, and nothing
 * answered for the front ends. On 2026-08-23 two E2E seam specs were red and
 * the only way to tell "the code is wrong" from "the bundle is old" was to ask
 * the operator whether web-admin had been rebuilt. Both readings were argued at
 * length and the wrong one was reported first.
 *
 * ── Why `/api/version` and not `/version` ───────────────────────────────────
 * Traefik gives the API `Host(admin.${DOMAIN}) && PathPrefix(/api/v1)` and
 * leaves everything else to this app, so `/api/...` outside `/v1` is ours.
 * `app/api/health/route.ts` already sits there; this follows it rather than
 * inventing a second convention.
 *
 * ── `force-dynamic` is a pin, not a fix ─────────────────────────────────────
 * It is NOT required today, and the first version of this comment claimed it
 * was. `node_modules/next/dist/docs/.../15-route-handlers.md` says plainly that
 * "Route Handlers are not cached by default" in this version, and building the
 * image without the directive was checked: it still reports the runtime commit,
 * not the build-time one.
 *
 * It stays because the failure it would cause is silent and total. `GIT_COMMIT`
 * is deliberately not a build arg — the compose comments explain that a
 * per-commit arg invalidates the whole image cache — so anything that
 * prerendered this handler would bake in `unknown` and serve it forever. An
 * endpoint whose only job is to be trusted should pin that, not inherit it from
 * a default that Cache Components already changes when enabled.
 * `app/api/health/api-reachable/route.ts` in web-public pins it the same way.
 */
export const dynamic = 'force-dynamic';

export function GET() {
  return Response.json({
    // Named so a sweep across the four hosts is self-identifying.
    app: 'web-admin',
    // Truncated to 8 like the API's `shortCommit`, so the same deploy never
    // shows as two different-looking commits.
    commit: (process.env.GIT_COMMIT || 'unknown').slice(0, 8),
    environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || 'production',
    // Seconds since this container started. The field that would have settled
    // the question above on its own: a redeploy resets it, so a large uptime
    // means the image predates whatever was just pushed.
    uptime: process.uptime(),
  });
}
