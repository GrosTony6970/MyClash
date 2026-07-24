import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Job } from 'bullmq';
import { initApiSentry } from '../common/observability/sentry';
import { SentryReportingWorkerHost } from './sentry-reporting-worker-host';

// Mirror sentry.test.ts: intercept the SDK so we can assert what would be sent
// without needing a live DSN transport.
const mocks = vi.hoisted(() => {
  const setContext = vi.fn();
  return {
    sentryInit: vi.fn(),
    captureException: vi.fn(),
    setContext,
    withScope: vi.fn((callback: (scope: { setContext: typeof setContext }) => void) => {
      callback({ setContext });
    }),
  };
});

vi.mock('@sentry/nestjs', () => ({
  init: mocks.sentryInit,
  captureException: mocks.captureException,
  withScope: mocks.withScope,
}));

// Minimal concrete worker so we can instantiate the abstract base.
class TestWorker extends SentryReportingWorkerHost {
  async process(): Promise<void> {
    // no-op; the base class's failure hook is what's under test
  }
}

function makeJob(overrides: Partial<Job>): Job {
  return {
    id: 'job-1',
    name: 'sync',
    queueName: 'hema-ratings-sync',
    attemptsMade: 1,
    opts: { attempts: 3 },
    ...overrides,
  } as Job;
}

describe('SentryReportingWorkerHost', () => {
  const worker = new TestWorker();

  beforeEach(() => {
    mocks.sentryInit.mockClear();
    mocks.captureException.mockClear();
    mocks.setContext.mockClear();
    mocks.withScope.mockClear();
    // Enable capture (DSN present) for the reporting assertions.
    initApiSentry({ SENTRY_DSN_API: 'https://example@sentry.io/1' });
  });

  it('does NOT report while retries remain', () => {
    worker.onJobFailed(makeJob({ attemptsMade: 1, opts: { attempts: 3 } }), new Error('transient'));
    worker.onJobFailed(makeJob({ attemptsMade: 2, opts: { attempts: 3 } }), new Error('transient'));
    expect(mocks.captureException).not.toHaveBeenCalled();
  });

  it('reports once the final attempt fails, with redacted job context', () => {
    const error = new Error('boom');
    worker.onJobFailed(makeJob({ attemptsMade: 3, opts: { attempts: 3 } }), error);

    expect(mocks.captureException).toHaveBeenCalledOnce();
    expect(mocks.captureException).toHaveBeenCalledWith(error);
    expect(mocks.setContext).toHaveBeenCalledWith('myclash', {
      source: 'bullmq',
      queue: 'hema-ratings-sync',
      jobName: 'sync',
      jobId: 'job-1',
      attemptsMade: 3,
    });
  });

  it('treats a missing attempts option as a single (final) attempt', () => {
    worker.onJobFailed(makeJob({ attemptsMade: 1, opts: {} }), new Error('boom'));
    expect(mocks.captureException).toHaveBeenCalledOnce();
  });

  it('no-ops when Sentry is disabled (no DSN)', () => {
    initApiSentry({});
    worker.onJobFailed(makeJob({ attemptsMade: 3, opts: { attempts: 3 } }), new Error('boom'));
    expect(mocks.captureException).not.toHaveBeenCalled();
  });
});
