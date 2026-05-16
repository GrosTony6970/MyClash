import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SuperAdminGuard } from './super-admin.guard';

const fromMock = vi.fn();
const getUserMock = vi.fn();
const fetchMock = vi.fn();

const mockSupabase = {
  anon: {
    auth: {
      getUser: getUserMock,
    },
  },
  service: {
    from: fromMock,
  },
};

const mockConfig = {
  get: vi.fn((key: string, fallback?: string) => {
    const values: Record<string, string> = {
      SUPABASE_AUTH_INTERNAL_URL: 'http://supabase-auth:9999',
    };
    return values[key] ?? fallback;
  }),
  getOrThrow: vi.fn((key: string) => {
    const values: Record<string, string> = {
      SUPABASE_URL: 'https://app.myclash.fr',
      SUPABASE_ANON_KEY: 'anon-key',
    };
    const value = values[key];
    if (!value) throw new Error(`Missing config ${key}`);
    return value;
  }),
};

function makeQueryChain(result: unknown) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue(result),
  };
}

function makeContext(request: unknown): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => request,
    }),
  } as ExecutionContext;
}

function mockAuthUser(user: Record<string, unknown>) {
  fetchMock.mockResolvedValue({
    ok: true,
    json: vi.fn().mockResolvedValue(user),
  });
}

describe('SuperAdminGuard', () => {
  let guard: SuperAdminGuard;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', fetchMock);
    fromMock.mockReturnValue(makeQueryChain({ data: null, error: null }));
    guard = new SuperAdminGuard(mockSupabase as never, mockConfig as never);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('validates cookies against internal GoTrue and allows platform super admins', async () => {
    mockAuthUser({ id: 'admin-123', app_metadata: {} });
    fromMock.mockReturnValueOnce(makeQueryChain({ data: { role: 'super_admin' }, error: null }));
    const request = { headers: {}, cookies: { 'sb-access-token': 'access-token' } };

    await expect(guard.canActivate(makeContext(request))).resolves.toBe(true);

    expect(fetchMock).toHaveBeenCalledWith(
      'http://supabase-auth:9999/user',
      expect.objectContaining({
        method: 'GET',
        headers: {
          apikey: 'anon-key',
          Authorization: 'Bearer access-token',
        },
      }),
    );
    expect(getUserMock).not.toHaveBeenCalled();
    expect(request).toMatchObject({ actorUserId: 'admin-123' });
  });

  it('rejects invalid tokens before querying platform roles', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      json: vi.fn().mockResolvedValue({ error: 'invalid_token' }),
    });

    await expect(
      guard.canActivate(makeContext({ headers: { authorization: 'Bearer bad-token' } })),
    ).rejects.toThrow(UnauthorizedException);

    expect(fromMock).not.toHaveBeenCalled();
    expect(getUserMock).not.toHaveBeenCalled();
  });

  it('falls back to app metadata when platform_roles is unavailable', async () => {
    mockAuthUser({ id: 'admin-123', app_metadata: { role: 'super_admin' } });
    fromMock.mockReturnValueOnce({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockRejectedValue(new Error('table missing')),
    });

    await expect(
      guard.canActivate(makeContext({ headers: { authorization: 'Bearer access-token' } })),
    ).resolves.toBe(true);
  });

  it('rejects authenticated users without super-admin access', async () => {
    mockAuthUser({ id: 'user-123', app_metadata: {} });

    await expect(
      guard.canActivate(makeContext({ headers: { authorization: 'Bearer access-token' } })),
    ).rejects.toThrow(ForbiddenException);
  });
});
