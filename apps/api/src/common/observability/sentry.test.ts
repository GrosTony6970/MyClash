import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SENTRY_DATA_COLLECTION } from '@myclash/types/sentry-data-collection';
import { captureApiException, initApiSentry, isApiSentryEnabled } from './sentry';

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

describe('API Sentry helper', () => {
  beforeEach(() => {
    mocks.sentryInit.mockClear();
    mocks.captureException.mockClear();
    mocks.setContext.mockClear();
    mocks.withScope.mockClear();
    initApiSentry({});
  });

  it('stays disabled when the API DSN is missing', () => {
    const result = initApiSentry({ NODE_ENV: 'production' });

    expect(result).toEqual({ enabled: false, environment: 'production' });
    expect(isApiSentryEnabled()).toBe(false);
    expect(mocks.sentryInit).not.toHaveBeenCalled();
  });

  it('initializes when the API DSN exists', () => {
    const result = initApiSentry({
      SENTRY_DSN_API: 'https://example@sentry.io/1',
      SENTRY_ENVIRONMENT: 'staging',
      SENTRY_RELEASE: 'abc123',
      SENTRY_TRACES_SAMPLE_RATE: '0.25',
    });

    expect(result).toEqual({ enabled: true, environment: 'staging', release: 'abc123' });
    expect(isApiSentryEnabled()).toBe(true);
    expect(mocks.sentryInit).toHaveBeenCalledWith({
      dsn: 'https://example@sentry.io/1',
      environment: 'staging',
      release: 'abc123',
      tracesSampleRate: 0.25,
      dataCollection: SENTRY_DATA_COLLECTION,
      traceLifecycle: 'stream',
      beforeSend: expect.any(Function),
      beforeBreadcrumb: expect.any(Function),
      beforeSendSpan: expect.any(Function),
    });
  });

  it('takes what may leave from the shared module, and not from the old switch', () => {
    // The privacy policy (§7.1) makes the promise. The old switch's name proved
    // nothing on Sentry 10, so its absence is asserted too: the resolved-options
    // test (sentry.resolved.test.ts) proves what the SDK really does with this.
    initApiSentry({ SENTRY_DSN_API: 'https://example@sentry.io/1' });

    const options = mocks.sentryInit.mock.calls.at(-1)?.[0] as Record<string, unknown>;
    expect(options['dataCollection']).toBe(SENTRY_DATA_COLLECTION);
    expect(options).not.toHaveProperty('sendDefaultPii');
  });

  it('scrubs the context path in the report only', () => {
    initApiSentry({ SENTRY_DSN_API: 'https://example@sentry.io/1' });
    const context = { path: '/api/v1/event-passes/probe-marker-1?t=probe-marker-2' };
    captureApiException(new Error('boom'), context);

    expect(mocks.setContext).toHaveBeenCalledWith('myclash', {
      path: '/api/v1/event-passes/[token]',
    });
    expect(context.path).toBe('/api/v1/event-passes/probe-marker-1?t=probe-marker-2');
  });

  it('captures exceptions with redacted context only when enabled', () => {
    const error = new Error('boom');
    captureApiException(error, { email: 'fighter@example.com' });
    expect(mocks.captureException).not.toHaveBeenCalled();

    initApiSentry({ SENTRY_DSN_API: 'https://example@sentry.io/1' });
    captureApiException(error, { email: 'fighter@example.com', path: '/api/v1/test' });

    expect(mocks.withScope).toHaveBeenCalledOnce();
    expect(mocks.setContext).toHaveBeenCalledWith('myclash', {
      email: '[redacted]',
      path: '/api/v1/test',
    });
    expect(mocks.captureException).toHaveBeenCalledWith(error);
  });
});
