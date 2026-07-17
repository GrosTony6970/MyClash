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

// When the scoring PWA is mounted under /scoring/* (same-origin
// proxy on admin.${DOMAIN}, plus the canonical scoring.${DOMAIN}
// routed through a stripprefix-equipped sibling router — see
// infra/docker-compose.prod.yml), Next must emit its static chunks
// under that prefix so Traefik routes them to the scoring container
// instead of admin. Gated on a build-time env so local dev at
// localhost:3002/ (no proxy, no prefix) keeps working.
const SCORING_ASSET_PREFIX = process.env['SCORING_ASSET_PREFIX'];

const nextConfig: NextConfig = {
  // Enable React strict mode for better development warnings
  reactStrictMode: true,

  // Standalone output for Docker — copies only the files needed to run
  // the app, resulting in a minimal production image.
  output: 'standalone',

  ...(SCORING_ASSET_PREFIX ? { assetPrefix: SCORING_ASSET_PREFIX } : {}),

  // Transpile shared workspace packages
  transpilePackages: ['@myclash/ui', '@myclash/types', '@myclash/i18n', '@myclash/api-client'],
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
