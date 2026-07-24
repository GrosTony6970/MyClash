import type { NextConfig } from 'next';
import { withSentryConfig } from '@sentry/nextjs';

// ── Build-time required env validation ─────────────────────────────────
// See apps/web-admin/next.config.ts for the rationale — same pattern.
// Fail `next build` immediately when a NEXT_PUBLIC_* required at
// runtime by a critical feature is missing, so the misconfiguration
// surfaces at deploy time instead of as a runtime fallback in the
// browser.
const REQUIRED_PROD_ENV = [
  'NEXT_PUBLIC_API_URL',
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
] as const;

if (process.env['NODE_ENV'] === 'production') {
  const missing = REQUIRED_PROD_ENV.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    throw new Error(
      `[web-public/next.config] Missing required build-time env vars: ${missing.join(', ')}. ` +
        `Check that apps/web-public/Dockerfile declares ARG for each, and infra/docker-compose.prod.yml ` +
        `passes a value for each under the web-public service's build.args block.`,
    );
  }
}

const output = process.env['MYCLASH_NEXT_OUTPUT'] === 'default' ? undefined : 'standalone';

const nextConfig: NextConfig = {
  // Enable React strict mode for better development warnings
  reactStrictMode: true,

  // Standalone output for Docker — copies only the files needed to run
  // the app, resulting in a minimal production image.
  ...(output ? { output } : {}),

  // Transpile shared workspace packages
  transpilePackages: [
    '@myclash/ui',
    '@myclash/types',
    '@myclash/i18n',
    '@myclash/api-client',
    '@myclash/time',
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
  project: 'web-public',
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
