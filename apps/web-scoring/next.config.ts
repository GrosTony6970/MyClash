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
      `[web-scoring/next.config] Missing required build-time env vars: ${missing.join(', ')}. ` +
        `Check that apps/web-scoring/Dockerfile declares ARG for each, and infra/docker-compose.prod.yml ` +
        `passes a value for each under the web-scoring service's build.args block.`,
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
  ],
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
