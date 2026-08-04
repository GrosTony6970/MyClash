import { beforeEach, describe, expect, it, vi } from 'vitest';
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
      sendDefaultPii: false,
    });
  });

  it('never opts in to Sentry PII collection', () => {
    // The privacy policy promises this: no IP address, no cookies, no request
    // body and no user identity reach Sentry. `false` is also the SDK default,
    // which is exactly why it is asserted here — a default that silently flips
    // on an upgrade would make a published document wrong with no diff to
    // review. If this test fails, the policy needs changing, not the test.
    initApiSentry({ SENTRY_DSN_API: 'https://example@sentry.io/1' });

    const options = mocks.sentryInit.mock.calls.at(-1)?.[0] as { sendDefaultPii?: boolean };
    expect(options.sendDefaultPii).toBe(false);
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
