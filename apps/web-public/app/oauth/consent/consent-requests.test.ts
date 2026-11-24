import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { answerConsent, fetchConsent, openConsent } from './consent-requests';

/**
 * The consent page's three calls. `/me` answers 200 `anonymous` when signed out, so that is the
 * signed-out test, never a failed response. A 403 or 410 from the answer is a result the card
 * can say in words, and a 503 or a dead network is "try again".
 */
let calls: Array<{ path: string; method: string; body: unknown }>;
let answers: Response[];

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': status < 400 ? 'application/json' : 'application/problem+json' },
  });

beforeEach(() => {
  calls = [];
  answers = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({
        path: String(input).replace(/^https?:\/\/[^/]+/u, ''),
        method: init?.method ?? 'GET',
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      });
      const next = answers.shift();
      if (!next) throw new Error('no answer queued');
      return next;
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

describe('openConsent', () => {
  it('sends a signed-out person to sign-in, then back to this very request', async () => {
    answers.push(json(200, { type: 'anonymous' }));
    expect(await openConsent('auth-1')).toEqual({
      kind: 'login',
      href: '/login?next=%2Foauth%2Fconsent%3Fauthorization_id%3Dauth-1',
    });
    expect(calls.map((c) => c.path)).toEqual(['/api/v1/me']);
  });

  it('shows the expired view for a blank id, without asking anyone', async () => {
    expect(await openConsent(null)).toEqual({ kind: 'expired' });
    expect(await openConsent('  ')).toEqual({ kind: 'expired' });
    expect(calls).toEqual([]);
  });

  it('reads the request once the person is signed in', async () => {
    answers.push(json(200, { type: 'claimed' }));
    answers.push(json(200, { kind: 'ask', clientName: 'Claude', callback: 'claude', scopes: [] }));
    expect(await openConsent('auth-1')).toMatchObject({ kind: 'ask' });
    expect(calls[1]?.path).toBe('/api/v1/me/oauth-consent/auth-1');
  });

  it('does not take an unreachable API for a signed-out person', async () => {
    answers.push(json(503, { status: 503, code: 'x', detail: 'x' }));
    expect(await openConsent('auth-1')).toEqual({ kind: 'network' });
  });
});

describe('fetchConsent', () => {
  it('answers network on a 503', async () => {
    answers.push(json(503, { status: 503, code: 'consent_unavailable', detail: 'x' }));
    expect(await fetchConsent('auth-1')).toEqual({ kind: 'network' });
  });
});

describe('answerConsent', () => {
  it('posts the action and hands back the redirect', async () => {
    answers.push(json(200, { redirectUrl: 'https://claude.ai/api/mcp/auth_callback?code=c' }));
    expect(await answerConsent('auth-1', 'deny')).toEqual({
      redirectUrl: 'https://claude.ai/api/mcp/auth_callback?code=c',
    });
    expect(calls[0]).toMatchObject({
      path: '/api/v1/me/oauth-consent/auth-1',
      method: 'POST',
      body: { action: 'deny' },
    });
  });

  it('reads 403 as refused, 410 as expired and a 503 as network', async () => {
    answers.push(json(403, { status: 403, code: 'not_claude', detail: 'x' }));
    answers.push(json(410, { status: 410, code: 'expired', detail: 'x' }));
    answers.push(json(503, { status: 503, code: 'consent_unavailable', detail: 'x' }));
    expect(await answerConsent('a', 'approve')).toEqual({ kind: 'refused' });
    expect(await answerConsent('a', 'approve')).toEqual({ kind: 'expired' });
    expect(await answerConsent('a', 'approve')).toEqual({ kind: 'network' });
  });

  it('reads a 403 with any other code as a failed request, not as refused', async () => {
    answers.push(json(403, { status: 403, code: 'FORBIDDEN', detail: 'x' }));
    expect(await answerConsent('a', 'approve')).toEqual({ kind: 'network' });
  });

  it('sends a lapsed login back to sign-in, then to this very request', async () => {
    answers.push(json(401, { status: 401, code: 'UNAUTHORIZED', detail: 'No session' }));
    expect(await answerConsent('auth-1', 'approve')).toEqual({
      kind: 'login',
      href: '/login?next=%2Foauth%2Fconsent%3Fauthorization_id%3Dauth-1',
    });
  });
});
