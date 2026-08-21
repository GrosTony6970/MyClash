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

  it('carries the same structured failure the seam would have returned', async () => {
    stub(problem({ detail: 'Venue is in use', code: 'already_pending' }, 409));

    const error = (await createApiClient('http://api')
      .delete('/api/v1/venues/v1')
      .catch((e: unknown) => e)) as ApiClientError;
    expect(error.failure).toEqual({
      kind: 'http',
      status: 409,
      detail: 'Venue is in use',
      code: 'already_pending',
      details: null,
      validationErrors: null,
    });
  });

  // An edge proxy answers with HTML, not problem+json, so there is no detail and
  // no code — and `failureMessage` reads that pair as an intermediary rather
  // than a dead session. Without this the classification is lost before any
  // screen sees it.
  it('classifies a bodiless 403 as unauthenticated with nothing in it', async () => {
    stub(new Response('<html>403 Forbidden</html>', { status: 403 }));

    const error = (await createApiClient('http://api')
      .post('/api/v1/staff/gear/p1/w1', { result: 'conditional', reason: 'thin elbow' })
      .catch((e: unknown) => e)) as ApiClientError;
    expect(error.failure).toEqual({
      kind: 'unauthenticated',
      status: 403,
      detail: null,
      code: null,
      details: null,
    });
  });
});
