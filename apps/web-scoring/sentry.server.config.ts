import * as Sentry from '@sentry/nextjs';

const dsn = process.env['NEXT_PUBLIC_SENTRY_DSN_SCORING'];

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env['SENTRY_ENVIRONMENT'] ?? process.env['NODE_ENV'] ?? 'production',
    release: process.env['SENTRY_RELEASE'] ?? process.env['GIT_COMMIT'],
    tracesSampleRate: Number(process.env['SENTRY_TRACES_SAMPLE_RATE'] ?? 0),
  });
}
