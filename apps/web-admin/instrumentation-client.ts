import * as Sentry from '@sentry/nextjs';

const dsn = process.env['NEXT_PUBLIC_SENTRY_DSN_ADMIN'];

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env['NEXT_PUBLIC_SENTRY_ENVIRONMENT'] ?? process.env['NODE_ENV'],
    release: process.env['NEXT_PUBLIC_SENTRY_RELEASE'],
    tracesSampleRate: Number(process.env['NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE'] ?? 0),
    // See apps/api/src/common/observability/sentry.ts for why this is stated
    // rather than left to the SDK default: the privacy policy promises it.
    sendDefaultPii: false,
  });
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
