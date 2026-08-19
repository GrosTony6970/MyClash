import type { NextConfig } from 'next';
import { withSentryConfig } from '@sentry/nextjs';

// ── Build-time required env validation ─────────────────────────────────
// See apps/web-admin/next.config.ts for the rationale — same pattern.
// Fail `next build` immediately when a NEXT_PUBLIC_* required at
// runtime by a critical feature is missing.
const REQUIRED_PROD_ENV = ['NEXT_PUBLIC_API_URL', 'NEXT_PUBLIC_PUBLIC_APP_URL'] as const;

if (process.env['NODE_ENV'] === 'production') {
  const missing = REQUIRED_PROD_ENV.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    throw new Error(
      `[web-staff/next.config] Missing required build-time env vars: ${missing.join(', ')}. ` +
        `Check that apps/web-staff/Dockerfile declares ARG for each, and infra/docker-compose.prod.yml ` +
        `passes a value for each under the web-staff service's build.args block.`,
    );
  }
}

// When the scoring PWA is mounted under /scoring/* (same-origin
// proxy on admin.${DOMAIN}, plus the canonical staff.${DOMAIN}
// routed through a stripprefix-equipped sibling router — see
// infra/docker-compose.prod.yml), Next must emit its static chunks
// under that prefix so Traefik routes them to the scoring container
// instead of admin. Gated on a build-time env so local dev at
// localhost:3002/ (no proxy, no prefix) keeps working.
const STAFF_ASSET_PREFIX = process.env['STAFF_ASSET_PREFIX'];

const nextConfig: NextConfig = {
  // Enable React strict mode for better development warnings
  reactStrictMode: true,

  // Standalone output for Docker — copies only the files needed to run
  // the app, resulting in a minimal production image.
  output: 'standalone',

  ...(STAFF_ASSET_PREFIX ? { assetPrefix: STAFF_ASSET_PREFIX } : {}),

  // Transpile shared workspace packages
  transpilePackages: [
    '@myclash/ui',
    '@myclash/types',
    '@myclash/i18n',
    '@myclash/next-i18n',
    '@myclash/api-client',
  ],
};

export default withSentryConfig(nextConfig, {
  // ── Source-map upload ──────────────────────────────────────────────────
  // Without these, client-side stack traces arrive in Sentry MINIFIED and
  // unreadable. Upload is gated on SENTRY_AUTH_TOKEN (build-time only — set in
  // the Dockerfile builder stage, never at runtime): when it's unset (local /
  // dev builds) the plugin skips upload and the build stays green. `org` is the
  // Sentry organisation slug — confirm the real value with the owner.
  org: 'myclash',
  // `web-scoring` is DELIBERATE and must not be "corrected" to match this app's
  // name. The app was renamed web-scoring → web-staff in 11db3c66, but a Sentry
  // project slug lives server-side at sentry.io, not here. Renaming it repo-side
  // first makes releases and source maps upload to a project that does not
  // exist — silently, with the gap invisible until a stack trace is needed and
  // arrives unminified. Rename the project at sentry.io and reissue its DSN
  // first; then this literal and `NEXT_PUBLIC_SENTRY_DSN_SCORING` (.env.example,
  // both Dockerfiles, both compose files, scripts/ensure-prod-env.mjs,
  // scripts/check-observability-review.mjs) move together.
  project: 'web-scoring',
  authToken: process.env['SENTRY_AUTH_TOKEN'],
  // Match the release the runtime tags events with (GIT_COMMIT) so uploaded
  // maps resolve for that release; falls back to plugin auto-detection when
  // SENTRY_RELEASE is unset (dev).
  release: { name: process.env['SENTRY_RELEASE'] },
  // Don't ship the generated .map files in the public bundle.
  sourcemaps: { deleteSourcemapsAfterUpload: true },
  silent: true,
  telemetry: false,
  webpack: {
    treeshake: {
      removeDebugLogging: true,
      removeTracing: true,
    },
  },
  bundleSizeOptimizations: {
    excludeDebugStatements: true,
    excludeTracing: true,
    excludeReplayIframe: true,
    excludeReplayShadowDom: true,
    excludeReplayWorker: true,
  },
});
