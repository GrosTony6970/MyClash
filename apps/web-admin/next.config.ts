import type { NextConfig } from 'next';
import { withSentryConfig } from '@sentry/nextjs';

// ── Build-time required env validation ─────────────────────────────────
// Runtime `requireClientEnv()` falls back to a dev URL + console.error
// when a NEXT_PUBLIC_* is empty in prod — that keeps the page rendering
// but means an operator only discovers misconfigurations by clicking
// through the deployed app and reading DevTools. This block makes the
// misconfiguration loud at the *right* layer: `next build` exits
// non-zero with the offending var name, the Docker layer fails fast,
// and the deploy log surfaces the error before any bundling finishes.
//
// Fires only when NODE_ENV === 'production' so `pnpm dev` and unit
// tests keep working with partial env files.
//
// If you add a NEXT_PUBLIC_* that's required at runtime by any
// critical feature in this app, register it here so the next build
// catches a forgotten Dockerfile ARG / docker-compose build-arg.
const REQUIRED_PROD_ENV = [
  'NEXT_PUBLIC_API_URL',
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'NEXT_PUBLIC_SCORING_URL',
  'NEXT_PUBLIC_PUBLIC_APP_URL',
] as const;

if (process.env['NODE_ENV'] === 'production') {
  const missing = REQUIRED_PROD_ENV.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    throw new Error(
      `[web-admin/next.config] Missing required build-time env vars: ${missing.join(', ')}. ` +
        `Check that apps/web-admin/Dockerfile declares ARG for each, and infra/docker-compose.prod.yml ` +
        `passes a value for each under the web-admin service's build.args block.`,
    );
  }
}

const nextConfig: NextConfig = {
  // Enable React strict mode for better development warnings
  reactStrictMode: true,

  // Standalone output for Docker — copies only the files needed to run
  // the app, resulting in a minimal production image.
  output: 'standalone',

  // Transpile shared workspace packages
  transpilePackages: [
    '@myclash/ui',
    '@myclash/types',
    '@myclash/design-tokens',
    '@myclash/i18n',
    '@myclash/api-client',
    '@myclash/time',
  ],

  // Permanent redirect for the legacy tournament config URL.
  // The scoring-config page was renamed to /settings as part of the tournament
  // configuration wizard; bookmarks and external links must still resolve.
  async redirects() {
    return [
      {
        source: '/org/:slug/events/:eventId/tournaments/:tournamentId/scoring-config',
        destination: '/org/:slug/events/:eventId/tournaments/:tournamentId/settings#match-format',
        permanent: true,
      },
      {
        // The single AI-settings page was split into the /admin/ai section;
        // keep old bookmarks/links resolving to the new AI dashboard.
        source: '/admin/ai-settings',
        destination: '/admin/ai',
        permanent: true,
      },
    ];
  },
};

export default withSentryConfig(nextConfig, {
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
