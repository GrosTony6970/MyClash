import { afterEach, describe, expect, it, vi } from 'vitest';

import { ApiClientError, createApiClient } from './index';

/**
 * `createApiClient` predates `apiRequest` and keeps its four web-staff call
 * sites. It is here for one property only: it reads a failed response through
 * the SAME `readDetail` the seam uses. It carried its own inline
 * `detail ?? message` until 2026-08-19, which is how one package came to hold
 * two problem+json readers that disagreed about a blank string.
 */
const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

function stub(res: Response) {
  globalThis.fetch = vi.fn(() => Promise.resolve(res)) as unknown as typeof fetch;
}

function problem(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/problem+json' },
  });
}

describe('createApiClient error reading', () => {
  it('puts the RFC 9457 detail in the thrown message', async () => {
    stub(problem({ detail: 'Venue is in use', message: 'Venue is in use' }, 409));

    await expect(createApiClient('http://api').get('/api/v1/venues/v1')).rejects.toThrow(
      /Venue is in use/,
    );
  });

  it('falls through a blank detail to the message, exactly as the seam does', async () => {
    stub(problem({ detail: '  ', message: 'Name is required' }, 400));

    await expect(createApiClient('http://api').get('/api/v1/venues')).rejects.toThrow(
      /Name is required/,
    );
  });

  it('names only the status when the body gives no reason', async () => {
    stub(problem({ code: 'BAD_REQUEST' }, 400));

    const error = await createApiClient('http://api')
      .get('/api/v1/venues')
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiClientError);
    expect((error as ApiClientError).message).toBe('GET /api/v1/venues failed: 400');
    expect((error as ApiClientError).status).toBe(400);
  });
});
