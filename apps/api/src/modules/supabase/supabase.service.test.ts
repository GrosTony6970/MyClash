import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as jwt from 'jsonwebtoken';
import { SupabaseService } from './supabase.service';

const SECRET = 'test-supabase-jwt-secret-at-least-32-characters-long';

function makeConfig(overrides: Record<string, string | undefined> = {}) {
  const values: Record<string, string | undefined> = {
    SUPABASE_URL: 'https://app.myclash.fr',
    SUPABASE_ANON_KEY: 'anon-key',
    SUPABASE_SERVICE_ROLE_KEY: 'service-key',
    SUPABASE_JWT_SECRET: SECRET,
    SUPABASE_AUTH_INTERNAL_URL: 'http://supabase-auth:9999',
    ...overrides,
  };
  return {
    get: (key: string) => values[key],
    getOrThrow: (key: string) => {
      const value = values[key];
      if (!value) throw new Error(`Missing config ${key}`);
      return value;
    },
  } as never;
}

describe('SupabaseService.getAuthUser', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('returns the GoTrue user when GoTrue is reachable and the token is valid', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ id: 'user-1', email: 'a@b.c' }),
    });
    const svc = new SupabaseService(makeConfig());
    const user = await svc.getAuthUser('any-token');
    expect(user).toMatchObject({ id: 'user-1', email: 'a@b.c' });
  });

  it('returns null on a clean 401 from GoTrue without falling back to local verify', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ error: 'invalid' }),
    });
    const svc = new SupabaseService(makeConfig());
    // A structurally valid, unexpired token is still rejected because GoTrue
    // actively said no (e.g. revoked) — revocation must win.
    const token = jwt.sign({ sub: 'user-2', email: 'a@b.c' }, SECRET, { expiresIn: '1h' });
    expect(await svc.getAuthUser(token)).toBeNull();
  });

  it('falls back to local JWT verification when GoTrue is unreachable (network error)', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));
    const svc = new SupabaseService(makeConfig());
    const token = jwt.sign(
      {
        sub: 'user-3',
        email: 'fighter@b.c',
        user_metadata: { display_name: 'X' },
        app_metadata: { provider: 'email' },
      },
      SECRET,
      { expiresIn: '1h' },
    );
    const user = await svc.getAuthUser(token);
    expect(user).toMatchObject({ id: 'user-3', email: 'fighter@b.c' });
    expect(user?.user_metadata).toEqual({ display_name: 'X' });
    // app_metadata is carried through too — it's authz-relevant.
    expect(user?.app_metadata).toEqual({ provider: 'email' });
  });

  it('falls back to local verify when GoTrue rate-limits us', async () => {
    // A 429 is GoTrue refusing to ANSWER, not GoTrue rejecting the token. It
    // used to land in the same bucket as a 401, so a burst of authenticated
    // traffic turned a signed-in operator anonymous — and on a draft event
    // that reads as `Event "<slug>" not found`, which is how this was found.
    fetchMock.mockResolvedValue({ ok: false, status: 429, json: async () => ({}) });
    const svc = new SupabaseService(makeConfig());
    const token = jwt.sign({ sub: 'user-429', email: 'a@b.c' }, SECRET, { expiresIn: '1h' });
    expect(await svc.getAuthUser(token)).toMatchObject({ id: 'user-429' });
  });

  it('falls back to local verify on a request timeout reported as 408', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 408, json: async () => ({}) });
    const svc = new SupabaseService(makeConfig());
    const token = jwt.sign({ sub: 'user-408' }, SECRET, { expiresIn: '1h' });
    expect(await svc.getAuthUser(token)).toMatchObject({ id: 'user-408' });
  });

  it('still rejects an expired token when GoTrue rate-limits us', async () => {
    // The fallback widens WHEN we verify locally, never WHAT local verify
    // accepts. Expiry and signature are still enforced.
    fetchMock.mockResolvedValue({ ok: false, status: 429, json: async () => ({}) });
    const svc = new SupabaseService(makeConfig());
    const expired = jwt.sign({ sub: 'user-429b' }, SECRET, { expiresIn: -10 });
    expect(await svc.getAuthUser(expired)).toBeNull();
  });

  it('still honours a 403 as a rejection, not an outage', async () => {
    // The line between the two buckets: 401/403 are GoTrue judging the token
    // (revoked, banned) and must keep winning over a locally-valid signature.
    fetchMock.mockResolvedValue({ ok: false, status: 403, json: async () => ({}) });
    const svc = new SupabaseService(makeConfig());
    const token = jwt.sign({ sub: 'user-403' }, SECRET, { expiresIn: '1h' });
    expect(await svc.getAuthUser(token)).toBeNull();
  });

  it('falls back to local verify on a 5xx and rejects an expired token', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 503, json: async () => ({}) });
    const svc = new SupabaseService(makeConfig());
    const expired = jwt.sign({ sub: 'user-4' }, SECRET, { expiresIn: -10 });
    expect(await svc.getAuthUser(expired)).toBeNull();
  });

  it('rejects a token signed with the wrong secret during local fallback', async () => {
    fetchMock.mockRejectedValue(new Error('down'));
    const svc = new SupabaseService(makeConfig());
    const forged = jwt.sign({ sub: 'user-5' }, 'a-different-secret-of-sufficient-length-xx', {
      expiresIn: '1h',
    });
    expect(await svc.getAuthUser(forged)).toBeNull();
  });

  it('returns null when GoTrue is down and no shared secret is configured', async () => {
    fetchMock.mockRejectedValue(new Error('down'));
    const svc = new SupabaseService(makeConfig({ SUPABASE_JWT_SECRET: undefined }));
    const token = jwt.sign({ sub: 'user-6' }, SECRET, { expiresIn: '1h' });
    expect(await svc.getAuthUser(token)).toBeNull();
  });
});

describe('SupabaseService.refreshSession', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('exchanges a refresh token for a fresh session via the refresh grant', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        access_token: 'new-access',
        refresh_token: 'new-refresh',
        expires_in: 3600,
        user: { id: 'user-1' },
      }),
    });
    const svc = new SupabaseService(makeConfig());
    const result = await svc.refreshSession('old-refresh');

    expect(result).toMatchObject({ access_token: 'new-access', refresh_token: 'new-refresh' });
    expect(fetchMock).toHaveBeenCalledWith(
      'http://supabase-auth:9999/token?grant_type=refresh_token',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ refresh_token: 'old-refresh' }),
      }),
    );
  });

  it('returns null when GoTrue rejects the refresh token', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ error: 'invalid_grant' }),
    });
    const svc = new SupabaseService(makeConfig());
    expect(await svc.refreshSession('bad')).toBeNull();
  });

  it('returns null when GoTrue is unreachable', async () => {
    fetchMock.mockRejectedValue(new Error('down'));
    const svc = new SupabaseService(makeConfig());
    expect(await svc.refreshSession('whatever')).toBeNull();
  });

  it('returns null when the response is missing tokens', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ access_token: 'only-access' }),
    });
    const svc = new SupabaseService(makeConfig());
    expect(await svc.refreshSession('r')).toBeNull();
  });
});
