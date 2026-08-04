import * as Sentry from '@sentry/nestjs';
import { redactValue } from './redaction';

export interface SentryInitResult {
  enabled: boolean;
  environment: string;
  release?: string;
}

let sentryEnabled = false;

export function initApiSentry(env: NodeJS.ProcessEnv = process.env): SentryInitResult {
  const dsn = env['SENTRY_DSN_API'];
  const environment = env['SENTRY_ENVIRONMENT'] || env['NODE_ENV'] || 'production';
  const release = env['SENTRY_RELEASE'] || env['GIT_COMMIT'] || undefined;

  if (!dsn) {
    sentryEnabled = false;
    return release ? { enabled: false, environment, release } : { enabled: false, environment };
  }

  Sentry.init({
    dsn,
    environment,
    release,
    tracesSampleRate: parseSampleRate(env['SENTRY_TRACES_SAMPLE_RATE']),
    // Stated, not left to the default. `false` IS the SDK default today, but
    // the privacy policy now makes a promise about it — no IP address, no
    // cookies, no request bodies, no user identity leaves for Sentry — and a
    // promise resting on a default is one SDK upgrade or one re-run of the
    // Sentry setup wizard away from being false. Written down, flipping it is
    // a visible diff instead of a silent change of behaviour.
    sendDefaultPii: false,
  });
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
  Sentry.withScope((scope) => {
    scope.setContext('myclash', redactValue(context) as Record<string, unknown>);
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
