import * as Sentry from '@sentry/nextjs';

const dsn = process.env['NEXT_PUBLIC_SENTRY_DSN_ADMIN'];

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env['NEXT_PUBLIC_SENTRY_ENVIRONMENT'] ?? process.env['NODE_ENV'],
    // Undefined in production, on purpose. Next can only put a NEXT_PUBLIC_*
    // value in the browser bundle by inlining it at build time, so tagging the
    // release with the commit SHA made the image differ on every commit and
    // rebuilt the whole app on every deploy. Server-side events still carry it
    // (sentry.server.config.ts, runtime env). Set the build arg again the day
    // source maps are uploaded — the maps have to name the build they match.
    release: process.env['NEXT_PUBLIC_SENTRY_RELEASE'],
    tracesSampleRate: Number(process.env['NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE'] ?? 0),
    // See apps/api/src/common/observability/sentry.ts for why this is stated
    // rather than left to the SDK default: the privacy policy promises it.
    sendDefaultPii: false,
  });
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
