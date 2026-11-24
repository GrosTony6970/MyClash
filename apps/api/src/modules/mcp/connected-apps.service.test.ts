import { UnauthorizedException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OperationalUnavailableException } from '../../common/operational-exception';
import { ConnectedAppsService } from './connected-apps.service';

const AUTH = 'http://supabase-auth:9999';
const LOGIN = 'the-persons-login';
const CLIENT = '3f2b8c1e-5a4d-4e6f-9b0a-1c2d3e4f5a6b';

function service(env: Record<string, string> = {}): ConnectedAppsService {
  const values: Record<string, string> = {
    SUPABASE_AUTH_INTERNAL_URL: AUTH,
    SUPABASE_URL: 'https://api.myclash.localhost',
    SUPABASE_ANON_KEY: 'anon-key',
    ...env,
  };
  const config = {
    get: (key: string) => values[key],
    getOrThrow: (key: string) => {
      const value = values[key];
      if (value === undefined) throw new Error(`missing ${key}`);
      return value;
    },
  };
  return new ConnectedAppsService(config as unknown as ConfigService);
}

function answer(status: number, body?: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function call(n: number): { url: string; init: RequestInit } {
  const [url, init] = fetchMock.mock.calls[n] ?? [];
  return { url: String(url), init: init ?? {} };
}

const grant = {
  client: { id: CLIENT, name: 'Claude', uri: 'https://claude.ai', logo_uri: '' },
  scopes: ['email'],
  granted_at: '2026-11-20T10:00:00Z',
};

describe('ConnectedAppsService.list', () => {
  it("asks GoTrue for the person's grants with their login, and no Origin", async () => {
    fetchMock.mockResolvedValueOnce(answer(200, []));
    await service().list(LOGIN);

    const { url, init } = call(0);
    expect(url).toBe(`${AUTH}/user/oauth/grants`);
    expect(init.method).toBe('GET');
    const headers = new Headers(init.headers);
    expect(headers.get('apikey')).toBe('anon-key');
    expect(headers.get('authorization')).toBe(`Bearer ${LOGIN}`);
    expect(headers.has('origin')).toBe(false);
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('maps a grant to client id, name and date, and keeps nothing else', async () => {
    fetchMock.mockResolvedValueOnce(answer(200, [grant]));
    await expect(service().list(LOGIN)).resolves.toEqual({
      apps: [{ clientId: CLIENT, name: 'Claude', grantedAt: '2026-11-20T10:00:00Z' }],
    });
  });

  it('answers an empty list when nothing is connected', async () => {
    fetchMock.mockResolvedValueOnce(answer(200, []));
    await expect(service().list(LOGIN)).resolves.toEqual({ apps: [] });
  });

  it('answers 401 when the login is refused', async () => {
    fetchMock.mockResolvedValueOnce(answer(401, { msg: 'bad jwt' }));
    await expect(service().list(LOGIN)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it.each([
    ['a 500', () => answer(500, {})],
    ['a body that is no array', () => answer(200, { grants: [] })],
    ['a grant with no client name', () => answer(200, [{ ...grant, client: { id: CLIENT } }])],
    ['a grant with no date', () => answer(200, [{ client: grant.client }])],
  ])('is a 503 on %s', async (_what, make) => {
    fetchMock.mockResolvedValueOnce(make());
    await expect(service().list(LOGIN)).rejects.toBeInstanceOf(OperationalUnavailableException);
  });

  it('is a 503 when GoTrue does not answer', async () => {
    fetchMock.mockRejectedValueOnce(new DOMException('timeout', 'TimeoutError'));
    await expect(service().list(LOGIN)).rejects.toBeInstanceOf(OperationalUnavailableException);
  });
});

describe('ConnectedAppsService.disconnect', () => {
  it('deletes the grant of that client with the login', async () => {
    fetchMock.mockResolvedValueOnce(answer(204));
    await service().disconnect(CLIENT, LOGIN);

    const { url, init } = call(0);
    expect(url).toBe(`${AUTH}/user/oauth/grants?client_id=${CLIENT}`);
    expect(init.method).toBe('DELETE');
    const headers = new Headers(init.headers);
    expect(headers.get('authorization')).toBe(`Bearer ${LOGIN}`);
    expect(headers.get('apikey')).toBe('anon-key');
    expect(headers.has('origin')).toBe(false);
  });

  it('reads a 404 as already gone', async () => {
    fetchMock.mockResolvedValueOnce(answer(404, { error_code: 'oauth_consent_not_found' }));
    await expect(service().disconnect(CLIENT, LOGIN)).resolves.toBeUndefined();
  });

  it('answers 401 when the login is refused', async () => {
    fetchMock.mockResolvedValueOnce(answer(401, {}));
    await expect(service().disconnect(CLIENT, LOGIN)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('is a 503 on a 500, and never reads it as gone', async () => {
    fetchMock.mockResolvedValueOnce(answer(500, {}));
    await expect(service().disconnect(CLIENT, LOGIN)).rejects.toBeInstanceOf(
      OperationalUnavailableException,
    );
  });
});
