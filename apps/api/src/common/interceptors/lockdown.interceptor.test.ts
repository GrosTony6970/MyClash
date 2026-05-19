import { ServiceUnavailableException } from '@nestjs/common';
import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { firstValueFrom, of } from 'rxjs';
import { LockdownInterceptor } from './lockdown.interceptor';

interface MockRequest {
  url: string;
  headers: Record<string, unknown>;
  cookies?: Record<string, string>;
}

function makeContext(req: MockRequest): ExecutionContext {
  return {
    getType: () => 'http',
    switchToHttp: () => ({ getRequest: () => req }),
  } as never;
}

function makeNext(): CallHandler {
  return { handle: () => of('passthrough') };
}

describe('LockdownInterceptor', () => {
  let isEnabledMock: ReturnType<typeof vi.fn>;
  let getAuthUserMock: ReturnType<typeof vi.fn>;
  let platformRolesMaybeSingle: ReturnType<typeof vi.fn>;
  let interceptor: LockdownInterceptor;

  beforeEach(() => {
    isEnabledMock = vi.fn().mockResolvedValue(false);
    getAuthUserMock = vi.fn().mockResolvedValue({ id: 'user-1' });
    platformRolesMaybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });

    const flags = { isEnabled: isEnabledMock };
    const supabase = {
      getAuthUser: getAuthUserMock,
      service: {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: platformRolesMaybeSingle,
        }),
      },
    };

    interceptor = new LockdownInterceptor(flags as never, supabase as never);
  });

  it('passes through unauthenticated requests without checking the flag', async () => {
    const ctx = makeContext({ url: '/api/v1/admin/organizations', headers: {} });
    const result = await interceptor.intercept(ctx, makeNext());
    expect(await firstValueFrom(result)).toBe('passthrough');
    expect(isEnabledMock).not.toHaveBeenCalled();
  });

  it('passes through allow-listed paths (auth, health, public) even with a token', async () => {
    const ctx = makeContext({
      url: '/api/v1/auth/login',
      headers: { authorization: 'Bearer t' },
    });
    const result = await interceptor.intercept(ctx, makeNext());
    expect(await firstValueFrom(result)).toBe('passthrough');
    expect(isEnabledMock).not.toHaveBeenCalled();
  });

  it('passes through non-protected paths', async () => {
    const ctx = makeContext({ url: '/api/v1/something-else', headers: {} });
    const result = await interceptor.intercept(ctx, makeNext());
    expect(await firstValueFrom(result)).toBe('passthrough');
  });

  it('passes through protected paths when the flag is off', async () => {
    isEnabledMock.mockResolvedValue(false);
    const ctx = makeContext({
      url: '/api/v1/admin/organizations',
      headers: { authorization: 'Bearer t' },
    });
    const result = await interceptor.intercept(ctx, makeNext());
    expect(await firstValueFrom(result)).toBe('passthrough');
    expect(isEnabledMock).toHaveBeenCalledWith('admin_lockdown');
  });

  it('passes through super admins even when the flag is on', async () => {
    isEnabledMock.mockResolvedValue(true);
    platformRolesMaybeSingle.mockResolvedValue({
      data: { role: 'super_admin' },
      error: null,
    });
    const ctx = makeContext({
      url: '/api/v1/admin/organizations',
      headers: { authorization: 'Bearer t' },
    });
    const result = await interceptor.intercept(ctx, makeNext());
    expect(await firstValueFrom(result)).toBe('passthrough');
  });

  it('blocks non-super-admins with 503 when the flag is on', async () => {
    isEnabledMock.mockResolvedValue(true);
    platformRolesMaybeSingle.mockResolvedValue({ data: null, error: null });
    const ctx = makeContext({
      url: '/api/v1/orgs/lyon-amhe/events',
      headers: { authorization: 'Bearer t' },
    });
    await expect(interceptor.intercept(ctx, makeNext())).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('reads the token from the sb-access-token cookie when no Authorization header is set', async () => {
    isEnabledMock.mockResolvedValue(true);
    platformRolesMaybeSingle.mockResolvedValue({ data: null, error: null });
    const ctx = makeContext({
      url: '/api/v1/admin/users',
      headers: {},
      cookies: { 'sb-access-token': 'cookie-token' },
    });
    await expect(interceptor.intercept(ctx, makeNext())).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(getAuthUserMock).toHaveBeenCalledWith('cookie-token');
  });
});
