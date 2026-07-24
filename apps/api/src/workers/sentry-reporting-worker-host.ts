/**
 * sentry-reporting-worker-host.ts
 *
 * Base class for every BullMQ `WorkerHost` in the API. Adds a single
 * `@OnWorkerEvent('failed')` hook that reports the failure to Sentry once the
 * job's retries are exhausted.
 *
 * Why this exists: BullMQ catches a processor's thrown error, marks the job
 * failed, and resolves internally — so the failure never becomes an
 * `unhandledRejection` (process handlers don't fire) and there is no HTTP
 * request (the global exception filter doesn't run). Background jobs (HEMA
 * ratings sync, event archive/status, data-quality scan, TLS-cert monitor,
 * notification delivery) therefore failed *silently* in Sentry. Concrete
 * workers get capture for free by extending this instead of `WorkerHost`.
 *
 * Retry-aware: the `failed` event fires on every attempt. We only report once
 * the final attempt has failed (`attemptsMade >= opts.attempts`) so retried
 * jobs don't spam Sentry with transient errors that later succeed.
 */

import { OnWorkerEvent, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { captureWorkerJobFailure } from '../common/observability/sentry';

export abstract class SentryReportingWorkerHost extends WorkerHost {
  @OnWorkerEvent('failed')
  onJobFailed(job: Job, error: Error): void {
    // `opts.attempts` defaults to 1 (no retry) when the queue sets none.
    const maxAttempts = job?.opts?.attempts ?? 1;
    if ((job?.attemptsMade ?? 0) >= maxAttempts) {
      captureWorkerJobFailure(job, error);
    }
  }
}
