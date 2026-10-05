/**
 * Renew-and-retry-once on a 401 (rulings 131, 153). The login cookie lasts an hour; `GET /api/v1/me`
 * renews it from the refresh cookie. A tap that lands after the hour answers 401: the client asks
 * `/me` once and, when the login is back, sends the same request once more. `apiRequest` (web-admin,
 * web-public) and `createApiClient` (web-staff) both go through it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createApiClient } from './index';
import { ME_PATH } from './me';
import { apiRequest } from './request';

const realFetch = globalThis.fetch;
const API = 'http://api';

type Call = { url: string; init: RequestInit };

beforeEach(() => {
  // The retry runs in a browser only: a server has no cookie jar to renew into.
  vi.stubGlobal('window', {});
});

afterEach(() => {
  globalThis.fetch = realFetch;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/problem+json' },
  });
}

const EXPIRED = () => json({ detail: 'Authentication required', code: 'UNAUTHORIZED' }, 401);
const CLAIMED = () => json({ type: 'claimed' });
const ANONYMOUS = () => json({ type: 'anonymous' });

/** A fetch that answers each call from `answers` in turn, and records every call. */
function stubFetch(...answers: Array<() => Response | Promise<Response>>) {
  const calls: Call[] = [];
  globalThis.fetch = vi.fn(async (url: string, init: RequestInit = {}) => {
    calls.push({ url, init });
    const next = answers.shift();
    if (!next) throw new Error(`unexpected call ${init.method ?? 'GET'} ${url}`);
    return next();
  }) as unknown as typeof fetch;
  return calls;
}

describe('apiRequest renews the login once on a 401, then retries once', () => {
  it('asks /me, then sends the same request again, and answers with the retry', async () => {
    const calls = stubFetch(EXPIRED, CLAIMED, () => json({ followed: true }, 201));
    const result = await apiRequest(API, '/api/v1/events/e1/follows', {
      method: 'POST',
      body: { personId: 'p1' },
    });
    expect(result).toEqual({ ok: true, data: { followed: true } });
    expect(calls.map((c) => `${c.init.method ?? 'GET'} ${c.url}`)).toEqual([
      'POST http://api/api/v1/events/e1/follows',
      `GET http://api${ME_PATH}`,
      'POST http://api/api/v1/events/e1/follows',
    ]);
    // The renewal carries the cookies and skips the cache; the retry is the same request.
    expect(calls[1]!.init).toMatchObject({ credentials: 'include', cache: 'no-store' });
    expect(calls[2]!.init.body).toBe('{"personId":"p1"}');
    expect(calls[2]!.init).toBe(calls[0]!.init);
  });

  it('does not retry when /me says the login is gone, and answers the first 401', async () => {
    const calls = stubFetch(EXPIRED, ANONYMOUS);
    const result = await apiRequest(API, '/api/v1/me/events');
    expect(result).toMatchObject({ ok: false, kind: 'unauthenticated', status: 401 });
    expect(result).toMatchObject({ detail: 'Authentication required' });
    expect(calls).toHaveLength(2);
  });

  it('retries once only: a second 401 is the answer', async () => {
    const calls = stubFetch(EXPIRED, CLAIMED, EXPIRED);
    const result = await apiRequest(API, '/api/v1/me/privacy');
    expect(result).toMatchObject({ ok: false, kind: 'unauthenticated', status: 401 });
    expect(calls).toHaveLength(3);
  });

  it('never re-sends a wrong password: the identity doors answer their own 401', async () => {
    const calls = stubFetch(() => json({ detail: 'Invalid email or password' }, 401));
    const result = await apiRequest(API, '/api/v1/auth/password-login', {
      method: 'POST',
      body: { email: 'a@b.c', password: 'nope' },
    });
    expect(result).toMatchObject({
      ok: false,
      kind: 'unauthenticated',
      detail: 'Invalid email or password',
    });
    expect(calls).toHaveLength(1);
  });

  it('never renews for /me itself', async () => {
    const calls = stubFetch(EXPIRED);
    await apiRequest(API, ME_PATH);
    expect(calls).toHaveLength(1);
  });

  it('never renews for a 403 or another failure', async () => {
    const calls = stubFetch(
      () => json({ detail: 'Not yours' }, 403),
      () => json({}, 500),
    );
    await apiRequest(API, '/api/v1/a');
    await apiRequest(API, '/api/v1/b');
    expect(calls.map((c) => c.url)).toEqual(['http://api/api/v1/a', 'http://api/api/v1/b']);
  });

  it('never renews on a server, which has no cookie jar to renew into', async () => {
    vi.unstubAllGlobals();
    const calls = stubFetch(EXPIRED);
    const result = await apiRequest(API, '/api/v1/a');
    expect(result).toMatchObject({ ok: false, kind: 'unauthenticated' });
    expect(calls).toHaveLength(1);
  });

  it('answers the first 401 when /me cannot be reached', async () => {
    const calls = stubFetch(EXPIRED, () => {
      throw new TypeError('Failed to fetch');
    });
    const result = await apiRequest(API, '/api/v1/a');
    expect(result).toMatchObject({ ok: false, kind: 'unauthenticated', status: 401 });
    expect(calls).toHaveLength(2);
  });

  // Ruling 302. `/me` renews the login before it reads the role and the clubs, and a fault of
  // those reads is a server error (ruling 295) that still carries the renewed cookies
  // (`me.renewal-rides-fault.http.test.ts` in the API).
  it('sends the request again when /me answers a server error', async () => {
    const calls = stubFetch(
      EXPIRED,
      () => json({ detail: 'Internal server error' }, 500),
      () => json({ followed: true }, 201),
    );
    const result = await apiRequest(API, '/api/v1/events/e1/follows', { method: 'POST' });
    expect(result).toEqual({ ok: true, data: { followed: true } });
    expect(calls).toHaveLength(3);
  });

  it('still retries once only after a server error from /me: a second 401 is the answer', async () => {
    const calls = stubFetch(EXPIRED, () => json({}, 503), EXPIRED);
    const result = await apiRequest(API, '/api/v1/a');
    expect(result).toMatchObject({ ok: false, kind: 'unauthenticated', status: 401 });
    expect(calls).toHaveLength(3);
  });

  it('does not retry when /me is refused below a server error: the edge answered, not /me', async () => {
    const calls = stubFetch(EXPIRED, () => json({}, 429));
    const result = await apiRequest(API, '/api/v1/a');
    expect(result).toMatchObject({ ok: false, kind: 'unauthenticated', status: 401 });
    expect(calls).toHaveLength(2);
  });

  it('never re-sends a body that can be read only once', async () => {
    const calls = stubFetch(EXPIRED);
    const body = new ReadableStream();
    const result = await apiRequest(API, '/api/v1/upload', { method: 'POST', body });
    expect(result).toMatchObject({ ok: false, kind: 'unauthenticated' });
    expect(calls).toHaveLength(1);
  });

  it('shares one renewal between requests refused at the same time', async () => {
    let releaseMe: () => void = () => undefined;
    const meGate = new Promise<void>((resolve) => {
      releaseMe = resolve;
    });
    const calls: Call[] = [];
    let firstRound = 2;
    globalThis.fetch = vi.fn(async (url: string, init: RequestInit = {}) => {
      calls.push({ url, init });
      if (url.endsWith(ME_PATH)) {
        await meGate;
        return CLAIMED();
      }
      if (firstRound > 0) {
        firstRound -= 1;
        if (firstRound === 0) setTimeout(releaseMe, 0);
        return EXPIRED();
      }
      return json({ ok: 1 });
    }) as unknown as typeof fetch;

    const [a, b] = await Promise.all([apiRequest(API, '/api/v1/a'), apiRequest(API, '/api/v1/b')]);
    expect([a.ok, b.ok]).toEqual([true, true]);
    expect(calls.filter((c) => c.url.endsWith(ME_PATH))).toHaveLength(1);
    expect(calls).toHaveLength(5);
  });

  it('a caller that aborts while the login renews gets "aborted", not a 401', async () => {
    const controller = new AbortController();
    stubFetch(
      EXPIRED,
      () => {
        controller.abort();
        return CLAIMED();
      },
      () => {
        throw Object.assign(new Error('aborted'), { name: 'AbortError' });
      },
    );
    const result = await apiRequest(API, '/api/v1/a', { signal: controller.signal });
    expect(result).toEqual({ ok: false, kind: 'aborted' });
  });
});

describe('createApiClient (web-staff) renews the same way', () => {
  it('retries a POST once the login is back, with the same body', async () => {
    const calls = stubFetch(EXPIRED, CLAIMED, () => json({ scored: true }));
    const api = createApiClient(API);
    await expect(api.post('/api/v1/matches/m1/exchanges', { points: 1 })).resolves.toEqual({
      scored: true,
    });
    expect(calls.map((c) => `${c.init.method ?? 'GET'} ${c.url}`)).toEqual([
      'POST http://api/api/v1/matches/m1/exchanges',
      `GET http://api${ME_PATH}`,
      'POST http://api/api/v1/matches/m1/exchanges',
    ]);
    expect(calls[2]!.init.body).toBe('{"points":1}');
  });

  it.each(['get', 'patch', 'delete'] as const)(
    '%s goes through the same renewal',
    async (method) => {
      const calls = stubFetch(EXPIRED, CLAIMED, () => json({}));
      const api = createApiClient(API);
      await (method === 'patch' ? api.patch('/api/v1/x', {}) : api[method]('/api/v1/x'));
      expect(calls).toHaveLength(3);
    },
  );

  it('never re-sends a wrong PIN, and never renews for a missing PIN session', async () => {
    const calls = stubFetch(
      () => json({ detail: 'Invalid staff credentials' }, 401),
      () => json({ detail: 'Staff session required' }, 401),
    );
    const api = createApiClient(API);
    await expect(api.post('/api/v1/staff-auth/login', { pin: '0000' })).rejects.toMatchObject({
      status: 401,
    });
    await expect(api.get('/api/v1/staff-auth/me')).rejects.toMatchObject({ status: 401 });
    expect(calls.map((c) => c.url)).toEqual([
      'http://api/api/v1/staff-auth/login',
      'http://api/api/v1/staff-auth/me',
    ]);
  });

  it('throws the first 401 when the login is gone', async () => {
    stubFetch(EXPIRED, ANONYMOUS);
    const api = createApiClient(API);
    await expect(api.get('/api/v1/x')).rejects.toMatchObject({ status: 401 });
  });
});
