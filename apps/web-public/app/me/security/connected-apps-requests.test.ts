import { afterEach, describe, expect, it, vi } from 'vitest';
import { readConnectedApps, requestDisconnectApp } from './security-requests';

/**
 * What the connected-apps section reads from the API. A failed read is `failed`, never an empty
 * list: an empty list says "no app is connected", which a person would believe.
 */
const API = 'https://api.example.test';

const response = (status: number, body?: object) =>
  new Response(body ? JSON.stringify(body) : 'refused', {
    status,
    headers: body ? { 'Content-Type': 'application/problem+json' } : {},
  });

/** The API's answers, one per call, in order. Hands back the stub to count the calls. */
function answers(...queue: Response[]) {
  const fetched = vi.fn();
  for (const next of queue) fetched.mockResolvedValueOnce(next);
  vi.stubGlobal('fetch', fetched);
  return fetched;
}

const noSession = () => response(401, { status: 401, code: 'UNAUTHORIZED', detail: 'No session' });
const me = (type: 'claimed' | 'anonymous') => response(200, { type });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the connected apps', () => {
  const APPS = { apps: [{ clientId: 'c-1', name: 'Claude', grantedAt: '2026-11-20T10:00:00Z' }] };
  const list = () => readConnectedApps(API, new AbortController().signal);
  // The renewal runs in a browser only: `fetchRenewingLogin` reads `window`.
  const inBrowser = () => vi.stubGlobal('window', globalThis);

  it('reads the list from the API with the login', async () => {
    const fetched = answers(response(200, APPS));

    expect(await list()).toEqual(APPS);
    const [url, init] = fetched.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${API}/api/v1/me/connected-apps`);
    expect(init.credentials).toBe('include');
  });

  it('reads a login that cannot be renewed as an ended session', async () => {
    inBrowser();
    answers(noSession(), me('anonymous'));

    expect(await list()).toBe('session_ended');
  });

  it.each([
    ['a server error', response(503, { status: 503, code: 'connected_apps_unavailable' })],
    ['a 401 of the edge, with no body', response(401)],
  ])('reads %s as a failed read, never as an empty list', async (_what, answer) => {
    answers(answer);

    expect(await list()).toBe('failed');
  });

  it('sends the disconnect as a DELETE of that app, with the login', async () => {
    const fetched = answers(new Response(null, { status: 204 }));

    expect(await requestDisconnectApp(API, 'c-1')).toBe('ok');
    const [url, init] = fetched.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${API}/api/v1/me/connected-apps/c-1`);
    expect(init.method).toBe('DELETE');
    expect(init.credentials).toBe('include');
  });

  it.each([
    ['a server error', () => answers(response(503, { status: 503 })), 'failed'],
    ['a refused id', () => answers(response(400, { status: 400 })), 'failed'],
    [
      'a lost connection',
      () => vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))),
      'network',
    ],
    [
      'a login that cannot be renewed',
      () => {
        inBrowser();
        answers(noSession(), me('anonymous'));
      },
      'session_ended',
    ],
  ])('answers for %s', async (_what, arrange, expected) => {
    arrange();

    expect(await requestDisconnectApp(API, 'c-1')).toBe(expected);
  });
});
