import { ForbiddenException, GoneException, UnauthorizedException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OperationalUnavailableException } from '../../common/operational-exception';
import { OAuthConsentService } from './oauth-consent.service';

const AUTH = 'http://supabase-auth:9999';
const ID = '3f2b8c1e-5a4d-4e6f-9b0a-1c2d3e4f5a6b';
const LOGIN = 'the-persons-login';
const CLAUDE = 'https://claude.ai/api/mcp/auth_callback';

function service(env: Record<string, string> = {}): OAuthConsentService {
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
  return new OAuthConsentService(config as unknown as ConfigService);
}

function details(redirectUri: string, scope = 'email profile') {
  return {
    authorization_id: ID,
    redirect_uri: redirectUri,
    client: { id: 'client-1', name: 'Claude', uri: '', logo_uri: '' },
    user: { id: 'user-1', email: 'someone@example.test' },
    scope,
  };
}

function answer(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
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

describe('OAuthConsentService.view', () => {
  it("asks GoTrue with the person's own login, and no Origin", async () => {
    fetchMock.mockResolvedValueOnce(answer(200, details(CLAUDE)));
    await service().view(ID, LOGIN);

    const { url, init } = call(0);
    expect(url).toBe(`${AUTH}/oauth/authorizations/${ID}`);
    expect(init.method).toBe('GET');
    const headers = new Headers(init.headers);
    expect(headers.get('apikey')).toBe('anon-key');
    expect(headers.get('authorization')).toBe(`Bearer ${LOGIN}`);
    expect(headers.has('origin')).toBe(false);
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('refuses to call anything when there is no internal auth address', async () => {
    await expect(
      service({ SUPABASE_AUTH_INTERNAL_URL: undefined as unknown as string }).view(ID, LOGIN),
    ).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('asks for a Claude client', async () => {
    fetchMock.mockResolvedValueOnce(answer(200, details(CLAUDE, 'email profile offline_access')));
    await expect(service().view(ID, LOGIN)).resolves.toEqual({
      kind: 'ask',
      clientName: 'Claude',
      callback: 'claude',
      scopes: ['email', 'profile', 'offline_access'],
    });
  });

  it('asks for Claude Code on this computer', async () => {
    fetchMock.mockResolvedValueOnce(answer(200, details('http://localhost:53682/callback')));
    await expect(service().view(ID, LOGIN)).resolves.toMatchObject({
      kind: 'ask',
      callback: 'this-computer',
    });
  });

  it('refuses a client outside the list', async () => {
    fetchMock.mockResolvedValueOnce(answer(200, details('https://evil.example/cb')));
    await expect(service().view(ID, LOGIN)).resolves.toEqual({
      kind: 'refused',
      reason: 'not-claude',
      redirectHost: 'evil.example',
    });
  });

  it('names the real host of a callback that hides it behind a user name', async () => {
    fetchMock.mockResolvedValueOnce(
      answer(200, details('https://claude.ai@evil.example/api/mcp/auth_callback')),
    );
    await expect(service().view(ID, LOGIN)).resolves.toEqual({
      kind: 'refused',
      reason: 'not-claude',
      redirectHost: 'evil.example',
    });
  });

  it('refuses an auto-approved redirect outside the list', async () => {
    fetchMock.mockResolvedValueOnce(
      answer(200, { redirect_url: 'https://evil.example/cb?code=x' }),
    );
    await expect(service().view(ID, LOGIN)).resolves.toEqual({
      kind: 'refused',
      reason: 'not-claude',
      redirectHost: 'evil.example',
    });
  });

  it('passes an auto-approved Claude redirect', async () => {
    const redirectUrl = `${CLAUDE}?code=c&state=s`;
    fetchMock.mockResolvedValueOnce(answer(200, { redirect_url: redirectUrl }));
    await expect(service().view(ID, LOGIN)).resolves.toEqual({ kind: 'go', redirectUrl });
  });

  it('GoTrue 404 reads as expired', async () => {
    fetchMock.mockResolvedValueOnce(answer(404, { code: 'oauth_authorization_not_found' }));
    await expect(service().view(ID, LOGIN)).resolves.toEqual({ kind: 'expired' });
  });

  it('GoTrue 400 (no longer pending) reads as expired', async () => {
    fetchMock.mockResolvedValueOnce(answer(400, { code: 'validation_failed' }));
    await expect(service().view(ID, LOGIN)).resolves.toEqual({ kind: 'expired' });
  });

  it('reads a malformed id as expired without asking GoTrue', async () => {
    await expect(service().view('../../admin/users', LOGIN)).resolves.toEqual({ kind: 'expired' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('answers 401 when GoTrue no longer takes the login, so the browser renews it', async () => {
    fetchMock.mockResolvedValueOnce(answer(401, { code: 'bad_jwt' }));
    await expect(service().view(ID, LOGIN)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it.each([
    ['a 5xx', () => answer(502, {})],
    ['a throttle', () => answer(429, {})],
    ['a 403 (the OAuth server is off, or the origin check failed)', () => answer(403, {})],
    ['an answer that is no JSON', () => new Response('<html>', { status: 200 })],
    ['details with no redirect_uri', () => answer(200, { ...details(CLAUDE), redirect_uri: 1 })],
    ['details with no client name', () => answer(200, { ...details(CLAUDE), client: {} })],
    ['details with no scope', () => answer(200, { ...details(CLAUDE), scope: null })],
    ['an empty object', () => answer(200, {})],
  ])('answers 503 on %s, never a guess', async (_name, reply) => {
    fetchMock.mockResolvedValueOnce(reply());
    await expect(service().view(ID, LOGIN)).rejects.toBeInstanceOf(OperationalUnavailableException);
  });

  it('answers 503 when GoTrue gives no answer in time', async () => {
    fetchMock.mockRejectedValueOnce(new DOMException('timed out', 'TimeoutError'));
    await expect(service().view(ID, LOGIN)).rejects.toBeInstanceOf(OperationalUnavailableException);
  });
});

describe('OAuthConsentService.answer', () => {
  it('approve re-reads the details first and denies a client outside the list', async () => {
    fetchMock
      .mockResolvedValueOnce(answer(200, details('https://evil.example/cb')))
      .mockResolvedValueOnce(answer(200, { redirect_url: 'https://evil.example/cb?error=x' }));

    const refused = service().answer(ID, LOGIN, 'approve');
    await expect(refused).rejects.toBeInstanceOf(ForbiddenException);
    await expect(refused).rejects.toThrow('not_claude');
    await expect(refused).rejects.toMatchObject({
      response: { code: 'not_claude' },
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(call(0).init.method).toBe('GET');
    const consent = call(1);
    expect(consent.url).toBe(`${AUTH}/oauth/authorizations/${ID}/consent`);
    expect(consent.init.method).toBe('POST');
    expect(JSON.parse(String(consent.init.body))).toEqual({ action: 'deny' });
    expect(new Headers(consent.init.headers).get('authorization')).toBe(`Bearer ${LOGIN}`);
    expect(new Headers(consent.init.headers).has('origin')).toBe(false);
  });

  it('approve on a Claude client posts approve and returns the redirect', async () => {
    const redirectUrl = `${CLAUDE}?code=c&state=s`;
    fetchMock
      .mockResolvedValueOnce(answer(200, details(CLAUDE)))
      .mockResolvedValueOnce(answer(200, { redirect_url: redirectUrl }));

    await expect(service().answer(ID, LOGIN, 'approve')).resolves.toEqual({ redirectUrl });
    expect(JSON.parse(String(call(1).init.body))).toEqual({ action: 'approve' });
  });

  it("refuses an approval whose redirect GoTrue sends somewhere else than the client's", async () => {
    fetchMock
      .mockResolvedValueOnce(answer(200, details(CLAUDE)))
      .mockResolvedValueOnce(answer(200, { redirect_url: 'https://evil.example/cb?code=c' }));

    await expect(service().answer(ID, LOGIN, 'approve')).rejects.toThrow('not_claude');
  });

  it('approve on an auto-approved Claude redirect returns it without posting consent', async () => {
    const redirectUrl = `${CLAUDE}?code=c&state=s`;
    fetchMock.mockResolvedValueOnce(answer(200, { redirect_url: redirectUrl }));

    await expect(service().answer(ID, LOGIN, 'approve')).resolves.toEqual({ redirectUrl });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('approve on an auto-approved redirect outside the list refuses without posting consent', async () => {
    fetchMock.mockResolvedValueOnce(
      answer(200, { redirect_url: 'https://evil.example/cb?code=x' }),
    );

    await expect(service().answer(ID, LOGIN, 'approve')).rejects.toThrow('not_claude');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('deny posts deny and returns the redirect back to Claude', async () => {
    const redirectUrl = `${CLAUDE}?error=access_denied&state=s`;
    fetchMock.mockResolvedValueOnce(answer(200, { redirect_url: redirectUrl }));

    await expect(service().answer(ID, LOGIN, 'deny')).resolves.toEqual({ redirectUrl });
    expect(call(0).url).toBe(`${AUTH}/oauth/authorizations/${ID}/consent`);
    expect(JSON.parse(String(call(0).init.body))).toEqual({ action: 'deny' });
  });

  it('deny never sends the browser to a stranger', async () => {
    fetchMock.mockResolvedValueOnce(
      answer(200, { redirect_url: 'https://evil.example/cb?error=access_denied' }),
    );
    await expect(service().answer(ID, LOGIN, 'deny')).rejects.toThrow('not_claude');
  });

  it('GoTrue 404 on the details reads as expired', async () => {
    fetchMock.mockResolvedValueOnce(answer(404, {}));
    await expect(service().answer(ID, LOGIN, 'approve')).rejects.toBeInstanceOf(GoneException);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('GoTrue 400 on the consent reads as expired', async () => {
    fetchMock
      .mockResolvedValueOnce(answer(200, details(CLAUDE)))
      .mockResolvedValueOnce(answer(400, {}));
    await expect(service().answer(ID, LOGIN, 'approve')).rejects.toThrow('expired');
  });

  it('answers 503 when the consent answer has no redirect_url', async () => {
    fetchMock
      .mockResolvedValueOnce(answer(200, details(CLAUDE)))
      .mockResolvedValueOnce(answer(200, { ok: true }));
    await expect(service().answer(ID, LOGIN, 'approve')).rejects.toBeInstanceOf(
      OperationalUnavailableException,
    );
  });
});
