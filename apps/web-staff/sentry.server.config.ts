import * as Sentry from '@sentry/nextjs';
import {
  SENTRY_DATA_COLLECTION,
  SENTRY_TRACE_LIFECYCLE,
  createSentryScrubbers,
  sentryOwnHosts,
} from '@myclash/types/sentry-data-collection';

const dsn = process.env['NEXT_PUBLIC_SENTRY_DSN_SCORING'];

if (dsn) {
  const scrubbers = createSentryScrubbers({
    ownHosts: sentryOwnHosts([
      process.env['API_URL_INTERNAL'],
      process.env['NEXT_PUBLIC_API_URL'],
      process.env['NEXT_PUBLIC_SUPABASE_URL'],
    ]),
    runtime: 'server',
  });
  Sentry.init({
    dsn,
    environment: process.env['SENTRY_ENVIRONMENT'] ?? process.env['NODE_ENV'] ?? 'production',
    release: process.env['SENTRY_RELEASE'] ?? process.env['GIT_COMMIT'],
    tracesSampleRate: Number(process.env['SENTRY_TRACES_SAMPLE_RATE'] ?? 0),
    // What may leave is owned by @myclash/types/sentry-data-collection; see
    // apps/api/src/common/observability/sentry.ts for why.
    dataCollection: SENTRY_DATA_COLLECTION,
    traceLifecycle: SENTRY_TRACE_LIFECYCLE,
    beforeSend: scrubbers.beforeSend,
    beforeBreadcrumb: scrubbers.beforeBreadcrumb,
    beforeSendSpan: scrubbers.beforeSendSpan,
  });
}
