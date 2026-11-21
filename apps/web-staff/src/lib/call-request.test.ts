import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiResult } from '@myclash/api-client';

/**
 * A referee's call from the pad (ruling 952). The board's "Needs attention"
 * had no way to be raised; the pad's Call button raises it. A call that reaches
 * nobody must say so, so the referee calls by voice.
 */
const answer = vi.hoisted(() => ({ next: null as unknown }));
const apiRequest = vi.hoisted(() => vi.fn(() => Promise.resolve(answer.next)));
vi.mock('@myclash/api-client', async (actual) => ({
  ...(await actual<typeof import('@myclash/api-client')>()),
  apiRequest,
}));

import { sendCall } from './call-request';

const next = (result: ApiResult<unknown>) => {
  answer.next = result;
};

describe('sendCall', () => {
  beforeEach(() => apiRequest.mockClear());

  it('posts the reason to the staff call', async () => {
    next({ ok: true, data: { ok: true } });

    await expect(sendCall('http://api.test', 'medic')).resolves.toBe('sent');

    expect(apiRequest).toHaveBeenCalledWith('http://api.test', '/api/v1/staff/attention', {
      method: 'POST',
      body: { reason: 'medic' },
    });
  });

  it('says no network when nothing answered', async () => {
    next({ ok: false, kind: 'network' });
    await expect(sendCall('', 'dispute')).resolves.toBe('offline');
  });

  it("reads the service worker's made-up 503 as no network", async () => {
    next({
      ok: false,
      kind: 'http',
      status: 503,
      detail: null,
      code: 'offline',
      details: null,
      validationErrors: null,
    });
    await expect(sendCall('', 'head_ref')).resolves.toBe('offline');
  });

  it('says refused when the server answered no', async () => {
    next({
      ok: false,
      kind: 'unauthenticated',
      status: 401,
      detail: null,
      code: null,
      details: null,
    });
    await expect(sendCall('', 'medic')).resolves.toBe('refused');
  });
});
