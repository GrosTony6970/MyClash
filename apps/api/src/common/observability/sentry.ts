import * as Sentry from '@sentry/nestjs';
import {
  SENTRY_DATA_COLLECTION,
  SENTRY_TRACE_LIFECYCLE,
  createSentryScrubbers,
  sentryOwnHosts,
} from '@myclash/types/sentry-data-collection';
import { redactValue } from './redaction';

export interface SentryInitResult {
  enabled: boolean;
  environment: string;
  release?: string;
}

let sentryEnabled = false;
let scrubContextPath: (url: string | undefined) => string | undefined = (url) => url;

export function initApiSentry(env: NodeJS.ProcessEnv = process.env): SentryInitResult {
  const dsn = env['SENTRY_DSN_API'];
  const environment = env['SENTRY_ENVIRONMENT'] || env['NODE_ENV'] || 'production';
  const release = env['SENTRY_RELEASE'] || env['GIT_COMMIT'] || undefined;

  if (!dsn) {
    sentryEnabled = false;
    return release ? { enabled: false, environment, release } : { enabled: false, environment };
  }

  // What a report may carry is the privacy policy's promise (§7.1). Sentry 10's
  // "no personal data" switch still sent cookies, bearer tokens, bodies and
  // query strings, so an option's name is no evidence. The settings and hooks
  // come from one shared module; the observability gate checks every init uses
  // them, and the envelope probe of the Sentry 11 slice proved what leaves.
  const scrubbers = createSentryScrubbers({
    ownHosts: sentryOwnHosts([env['SUPABASE_URL'], env['SUPABASE_AUTH_INTERNAL_URL']]),
    domain: env['DOMAIN'],
    runtime: 'server',
  });
  Sentry.init({
    dsn,
    environment,
    release,
    tracesSampleRate: parseSampleRate(env['SENTRY_TRACES_SAMPLE_RATE']),
    dataCollection: SENTRY_DATA_COLLECTION,
    traceLifecycle: SENTRY_TRACE_LIFECYCLE,
    beforeSend: scrubbers.beforeSend,
    beforeBreadcrumb: scrubbers.beforeBreadcrumb,
    beforeSendSpan: scrubbers.beforeSendSpan,
  });
  scrubContextPath = scrubbers.scrubUrl;
  sentryEnabled = true;

  return release ? { enabled: true, environment, release } : { enabled: true, environment };
}

export function isApiSentryEnabled(): boolean {
  return sentryEnabled;
}

export function captureApiException(
  exception: unknown,
  context: Record<string, unknown> = {},
): void {
  if (!sentryEnabled) return;
  // The reporter scrubs, not the caller: the exception filter also puts this
  // path in the error reply, which keeps its shape.
  const scrubbed =
    typeof context['path'] === 'string'
      ? { ...context, path: scrubContextPath(context['path']) }
      : context;
  Sentry.withScope((scope) => {
    scope.setContext('myclash', redactValue(scrubbed) as Record<string, unknown>);
    Sentry.captureException(exception);
  });
}

/** Minimal structural view of a BullMQ Job — avoids coupling observability to bullmq. */
export interface WorkerJobLike {
  id?: string | number;
  name?: string;
  queueName?: string;
  attemptsMade?: number;
}

/**
 * Report a failed BullMQ job to Sentry. BullMQ swallows processor rejections
 * (no HTTP request → the exception filter never runs; the promise is handled →
 * no `unhandledRejection`), so without this hook background-job failures are
 * invisible in Sentry. Reuses `captureApiException` for the redacted-context +
 * enabled-guard path. No-ops when Sentry is disabled.
 */
export function captureWorkerJobFailure(job: WorkerJobLike, error: unknown): void {
  captureApiException(error, {
    source: 'bullmq',
    queue: job?.queueName,
    jobName: job?.name,
    jobId: job?.id,
    attemptsMade: job?.attemptsMade,
  });
}

function parseSampleRate(value: string | undefined): number {
  if (!value) return 0;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.min(1, Math.max(0, parsed));
}
