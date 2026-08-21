import { afterEach, describe, expect, it, vi } from 'vitest';

import { apiRequest, isAbortLike, type ApiResult } from './request';

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

/** Replace the global fetch and hand back the spy, so a test can read the init. */
function stubFetch(impl: (url: string, init: RequestInit) => Promise<Response> | Response) {
  const spy = vi.fn(impl as unknown as typeof fetch);
  globalThis.fetch = spy as unknown as typeof fetch;
  return spy;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/problem+json' },
  });
}

/** What an edge proxy serves when it answers instead of the API. */
function html(status: number): Response {
  return new Response('<html><body>502 Bad Gateway</body></html>', {
    status,
    headers: { 'content-type': 'text/html' },
  });
}

function named(name: string): Error {
  const err = new Error(name);
  err.name = name;
  return err;
}

/** Narrow for the assertions — a failure read as a success is the bug we hunt. */
function failure<T>(result: ApiResult<T>) {
  if (result.ok) throw new Error(`expected a failure, got data: ${JSON.stringify(result.data)}`);
  return result;
}

describe('apiRequest — success', () => {
  it('returns the parsed body', async () => {
    stubFetch(() => json({ id: 'v1', name: 'Salle Nord' }));

    const result = await apiRequest<{ id: string; name: string }>('http://api', '/api/v1/venues');

    expect(result).toEqual({ ok: true, data: { id: 'v1', name: 'Salle Nord' } });
  });

  it('resolves a 204 to undefined data rather than a parse error', async () => {
    stubFetch(() => new Response(null, { status: 204 }));

    const result = await apiRequest('http://api', '/api/v1/venues/v1', { method: 'DELETE' });

    expect(result).toEqual({ ok: true, data: undefined });
  });
});

describe('apiRequest — failures', () => {
  it('reports 401 as unauthenticated, carrying the status and the reason', async () => {
    stubFetch(() => json({ detail: 'Unauthorized' }, 401));

    expect(failure(await apiRequest('http://api', '/api/v1/me'))).toEqual({
      ok: false,
      kind: 'unauthenticated',
      status: 401,
      detail: 'Unauthorized',
    });
  });

  it('reports 403 as unauthenticated too — the same screen, a different reason', async () => {
    stubFetch(() => json({ detail: 'Forbidden' }, 403));

    expect(failure(await apiRequest('http://api', '/api/v1/admin/users'))).toEqual({
      ok: false,
      kind: 'unauthenticated',
      status: 403,
      detail: 'Forbidden',
    });
  });

  it("keeps a 403's specific reason instead of discarding the body", async () => {
    // The whole point of reading the body before classifying: this sentence
    // cannot be reconstructed from the status.
    stubFetch(() => json({ detail: 'You are not a referee on this pool' }, 403));

    expect(failure(await apiRequest('http://api', '/api/v1/pools/p1/referees'))).toEqual({
      ok: false,
      kind: 'unauthenticated',
      status: 403,
      detail: 'You are not a referee on this pool',
    });
  });

  it('treats a blank 403 reason as no reason', async () => {
    stubFetch(() => json({ detail: '   ', message: '' }, 403));

    expect(failure(await apiRequest('http://api', '/api/v1/admin/users'))).toEqual({
      ok: false,
      kind: 'unauthenticated',
      status: 403,
      detail: null,
    });
  });

  it('still classifies a 403 whose body is not JSON at all', async () => {
    // An edge proxy answering for the API. Reading the body first must not turn
    // a permission failure into a network one.
    stubFetch(() => html(403));

    expect(failure(await apiRequest('http://api', '/api/v1/admin/users'))).toEqual({
      ok: false,
      kind: 'unauthenticated',
      status: 403,
      detail: null,
    });
  });

  it('reads the reason from the RFC 9457 `detail` member', async () => {
    stubFetch(() => json({ detail: 'Venue is in use', message: 'Venue is in use' }, 409));

    expect(failure(await apiRequest('http://api', '/api/v1/venues/v1'))).toEqual({
      ok: false,
      kind: 'http',
      status: 409,
      detail: 'Venue is in use',
      validationErrors: null,
    });
  });

  it('carries every rejected field, not only the one the API put in `detail`', async () => {
    // A class-validator refusal: the filter puts `rawMessage[0]` in `detail`
    // and the whole array under `details.validationErrors`.
    stubFetch(() =>
      json(
        {
          detail: 'email must be an email',
          message: 'email must be an email',
          details: {
            validationErrors: ['email must be an email', 'name should not be empty'],
          },
        },
        400,
      ),
    );

    expect(failure(await apiRequest('http://api', '/api/v1/events'))).toMatchObject({
      detail: 'email must be an email',
      validationErrors: ['email must be an email', 'name should not be empty'],
    });
  });

  it('reports no field list when `details` carries something else entirely', async () => {
    // `details` is a general bag — a conflict puts its own payload there. Only
    // `validationErrors` is a field list, and only when it holds strings.
    stubFetch(() =>
      json({ detail: 'Venue is in use', details: { blockers: [{ id: 'm1' }] } }, 409),
    );

    expect(failure(await apiRequest('http://api', '/api/v1/venues/v1'))).toMatchObject({
      validationErrors: null,
    });
  });

  it('rejects a field list that is empty or not all strings', async () => {
    stubFetch(() => json({ detail: 'Bad request', details: { validationErrors: [] } }, 400));
    expect(failure(await apiRequest('http://api', '/api/v1/events'))).toMatchObject({
      validationErrors: null,
    });

    stubFetch(() => json({ detail: 'Bad request', details: { validationErrors: [{}, 3] } }, 400));
    expect(failure(await apiRequest('http://api', '/api/v1/events'))).toMatchObject({
      validationErrors: null,
    });
  });

  it('prefers `detail` over the `message` extension when they disagree', async () => {
    stubFetch(() => json({ detail: 'standard', message: 'extension' }, 400));

    expect(failure(await apiRequest('http://api', '/api/v1/venues'))).toMatchObject({
      detail: 'standard',
    });
  });

  it('falls back to `message` when the body carries no `detail`', async () => {
    stubFetch(() => json({ message: 'Name is required' }, 400));

    expect(failure(await apiRequest('http://api', '/api/v1/venues'))).toMatchObject({
      kind: 'http',
      detail: 'Name is required',
    });
  });

  it('reports a null detail when the body carries neither member', async () => {
    stubFetch(() => json({ code: 'BAD_REQUEST' }, 400));

    expect(failure(await apiRequest('http://api', '/api/v1/venues'))).toMatchObject({
      kind: 'http',
      detail: null,
    });
  });

  it('treats a blank detail as no detail — whitespace tells the operator nothing', async () => {
    stubFetch(() => json({ detail: '   ', message: 'Name is required' }, 400));

    expect(failure(await apiRequest('http://api', '/api/v1/venues'))).toMatchObject({
      detail: 'Name is required',
    });
  });

  it('survives a proxy HTML page on a failed response, with no detail to give', async () => {
    stubFetch(() => html(502));

    expect(failure(await apiRequest('http://api', '/api/v1/venues'))).toEqual({
      ok: false,
      kind: 'http',
      status: 502,
      detail: null,
      validationErrors: null,
    });
  });

  it('reports a proxy HTML page on a 200 as a network failure', async () => {
    stubFetch(() => html(200));

    expect(failure(await apiRequest('http://api', '/api/v1/venues'))).toEqual({
      ok: false,
      kind: 'network',
    });
  });

  it('reports a rejected fetch as a network failure', async () => {
    stubFetch(() => Promise.reject(new TypeError('Failed to fetch')));

    expect(failure(await apiRequest('http://api', '/api/v1/venues'))).toEqual({
      ok: false,
      kind: 'network',
    });
  });

  it('reports an aborted fetch as aborted, not as a network failure', async () => {
    stubFetch(() => Promise.reject(named('AbortError')));

    expect(failure(await apiRequest('http://api', '/api/v1/venues'))).toEqual({
      ok: false,
      kind: 'aborted',
    });
  });

  it('reports an AbortSignal.timeout rejection as aborted', async () => {
    stubFetch(() => Promise.reject(named('TimeoutError')));

    expect(failure(await apiRequest('http://api', '/api/v1/venues'))).toEqual({
      ok: false,
      kind: 'aborted',
    });
  });

  it('reports an abort that lands between the headers and the body as aborted', async () => {
    stubFetch(
      () =>
        ({
          ok: true,
          status: 200,
          text: () => Promise.reject(named('AbortError')),
        }) as unknown as Response,
    );

    expect(failure(await apiRequest('http://api', '/api/v1/venues'))).toEqual({
      ok: false,
      kind: 'aborted',
    });
  });
});

describe('apiRequest — the request it sends', () => {
  it('sends the session cookie by default', async () => {
    const spy = stubFetch(() => json({}));

    await apiRequest('http://api', '/api/v1/me');

    expect(spy.mock.calls[0]?.[0]).toBe('http://api/api/v1/me');
    expect((spy.mock.calls[0]?.[1] as RequestInit).credentials).toBe('include');
  });

  it('lets the caller override the credentials mode', async () => {
    const spy = stubFetch(() => json({}));

    await apiRequest('http://api', '/api/v1/me', { credentials: 'omit' });

    expect((spy.mock.calls[0]?.[1] as RequestInit).credentials).toBe('omit');
  });

  it('serialises a plain body as JSON and declares the content type', async () => {
    const spy = stubFetch(() => json({}, 201));

    await apiRequest('http://api', '/api/v1/venues', {
      method: 'POST',
      body: { name: 'Salle Nord' },
    });

    const init = spy.mock.calls[0]?.[1] as RequestInit;
    expect(init.body).toBe('{"name":"Salle Nord"}');
    expect(new Headers(init.headers).get('content-type')).toBe('application/json');
  });

  it('passes FormData through untouched — stringifying it would drop the upload', async () => {
    const spy = stubFetch(() => json({}, 201));
    const form = new FormData();
    form.append('file', new Blob(['x']), 'photo.png');

    await apiRequest('http://api', '/api/v1/fighters/f1/photo', { method: 'POST', body: form });

    const init = spy.mock.calls[0]?.[1] as RequestInit;
    expect(init.body).toBe(form);
    // No content type at all: the boundary is the browser's to write.
    expect(new Headers(init.headers).get('content-type')).toBeNull();
  });

  it('merges caller headers over the defaults', async () => {
    const spy = stubFetch(() => json({}));

    await apiRequest('http://api', '/api/v1/exports', {
      headers: { Accept: 'text/csv', 'Content-Type': 'text/plain' },
      body: { q: 1 },
    });

    const sent = new Headers((spy.mock.calls[0]?.[1] as RequestInit).headers);
    expect(sent.get('accept')).toBe('text/csv');
    expect(sent.get('content-type')).toBe('text/plain');
  });

  it('keeps caller headers given as a Headers instance', async () => {
    // Spreading one yields `{}`, so every header would have vanished in silence.
    const spy = stubFetch(() => json({}));

    await apiRequest('http://api', '/api/v1/exports', {
      headers: new Headers({ Accept: 'text/csv', 'X-Request-Id': 'r1' }),
      body: { q: 1 },
    });

    const sent = new Headers((spy.mock.calls[0]?.[1] as RequestInit).headers);
    expect(sent.get('accept')).toBe('text/csv');
    expect(sent.get('x-request-id')).toBe('r1');
    expect(sent.get('content-type')).toBe('application/json');
  });

  it('keeps caller headers given as an array of pairs', async () => {
    const spy = stubFetch(() => json({}));

    await apiRequest('http://api', '/api/v1/exports', {
      headers: [['Accept', 'text/csv']],
    });

    expect(new Headers((spy.mock.calls[0]?.[1] as RequestInit).headers).get('accept')).toBe(
      'text/csv',
    );
  });
});

describe('isAbortLike', () => {
  it('accepts both names an abort arrives under', () => {
    expect(isAbortLike(named('AbortError'))).toBe(true);
    expect(isAbortLike(named('TimeoutError'))).toBe(true);
    expect(isAbortLike(new DOMException('aborted', 'AbortError'))).toBe(true);
  });

  it('rejects everything else, including the values a catch really receives', () => {
    expect(isAbortLike(new TypeError('Failed to fetch'))).toBe(false);
    expect(isAbortLike(null)).toBe(false);
    expect(isAbortLike(undefined)).toBe(false);
    expect(isAbortLike('AbortError')).toBe(false);
  });
});
