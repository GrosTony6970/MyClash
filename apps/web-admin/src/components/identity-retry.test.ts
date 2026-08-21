import { describe, expect, it } from 'vitest';
import type { ApiFailure } from '@myclash/api-client';

import { IDENTITY_MAX_ATTEMPTS, identityRetryDelayMs } from './identity-retry';

const http = (status: number): ApiFailure => ({
  kind: 'http',
  status,
  detail: null,
  code: null,
  validationErrors: null,
});

describe('identityRetryDelayMs', () => {
  it('retries a dropped connection, then gives up inside the budget', () => {
    const delays: Array<number | null> = [];
    for (let attempt = 1; attempt <= IDENTITY_MAX_ATTEMPTS; attempt++) {
      delays.push(identityRetryDelayMs({ kind: 'network' }, attempt));
    }
    // One delay per retry, and the last attempt has none left to schedule.
    expect(delays.filter((d) => d !== null)).toHaveLength(IDENTITY_MAX_ATTEMPTS - 1);
    expect(delays.at(-1)).toBeNull();
  });

  it('backs off rather than hammering', () => {
    const first = identityRetryDelayMs({ kind: 'network' }, 1);
    const second = identityRetryDelayMs({ kind: 'network' }, 2);
    expect(first).toBeGreaterThan(0);
    expect(second).toBeGreaterThan(first!);
  });

  it('never schedules anything once the budget is spent', () => {
    expect(identityRetryDelayMs({ kind: 'network' }, IDENTITY_MAX_ATTEMPTS)).toBeNull();
    expect(identityRetryDelayMs({ kind: 'network' }, 99)).toBeNull();
  });

  it('retries a 5xx — the API failing to answer is not an answer', () => {
    expect(identityRetryDelayMs(http(500), 1)).toBeGreaterThan(0);
    expect(identityRetryDelayMs(http(502), 1)).toBeGreaterThan(0);
  });

  it('retries a 429, because that is the one 4xx that means "not now"', () => {
    expect(identityRetryDelayMs(http(429), 1)).toBeGreaterThan(0);
  });

  it('does not retry the other 4xx — asking again gets the same reply', () => {
    expect(identityRetryDelayMs(http(400), 1)).toBeNull();
    expect(identityRetryDelayMs(http(404), 1)).toBeNull();
  });

  it('does not retry an abort — the caller unmounted on purpose', () => {
    expect(identityRetryDelayMs({ kind: 'aborted' }, 1)).toBeNull();
  });

  it('does not retry 401/403 — an answer about identity, not a failure to get one', () => {
    // Abnormal on a @Public() route, but still the server telling us something.
    expect(
      identityRetryDelayMs({ kind: 'unauthenticated', status: 401, detail: null, code: null }, 1),
    ).toBeNull();
    expect(
      identityRetryDelayMs({ kind: 'unauthenticated', status: 403, detail: null, code: null }, 1),
    ).toBeNull();
  });
});
