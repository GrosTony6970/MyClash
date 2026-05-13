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

function parseSampleRate(value: string | undefined): number {
  if (!value) return 0;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.min(1, Math.max(0, parsed));
}
