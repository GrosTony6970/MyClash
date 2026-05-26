import { ServiceUnavailableException } from '@nestjs/common';
import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { firstValueFrom, of } from 'rxjs';
import { ReadOnlyInterceptor } from './read-only.interceptor';

interface MockRequest {
  url: string;
  method?: string;
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

describe('ReadOnlyInterceptor', () => {
  let isEnabledMock: ReturnType<typeof vi.fn>;
  let getAuthUserMock: ReturnType<typeof vi.fn>;
  let platformRolesMaybeSingle: ReturnType<typeof vi.fn>;
  let interceptor: ReadOnlyInterceptor;

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

    interceptor = new ReadOnlyInterceptor(flags as never, supabase as never);
  });

  it('passes through GET requests even when the flag is on', async () => {
    isEnabledMock.mockResolvedValue(true);
    const ctx = makeContext({
      url: '/api/v1/orgs/lyon-amhe/events',
      method: 'GET',
      headers: { authorization: 'Bearer t' },
    });
    const result = await interceptor.intercept(ctx, makeNext());
    expect(await firstValueFrom(result)).toBe('passthrough');
    // GET short-circuits before the flag lookup
    expect(isEnabledMock).not.toHaveBeenCalled();
  });

  it.each(['HEAD', 'OPTIONS'])('passes through %s requests', async (method) => {
    isEnabledMock.mockResolvedValue(true);
    const ctx = makeContext({
      url: '/api/v1/admin/users',
      method,
      headers: { authorization: 'Bearer t' },
    });
    const result = await interceptor.intercept(ctx, makeNext());
    expect(await firstValueFrom(result)).toBe('passthrough');
  });

  it.each(['/api/v1/auth/signup', '/api/v1/health', '/api/v1/public/feature-flags'])(
    'passes through allow-listed write to %s',
    async (url) => {
      isEnabledMock.mockResolvedValue(true);
      const ctx = makeContext({ url, method: 'POST', headers: {} });
      const result = await interceptor.intercept(ctx, makeNext());
      expect(await firstValueFrom(result)).toBe('passthrough');
    },
  );

  it('passes through writes when the flag is off', async () => {
    isEnabledMock.mockResolvedValue(false);
    const ctx = makeContext({
      url: '/api/v1/admin/organizations',
      method: 'POST',
      headers: { authorization: 'Bearer t' },
    });
    const result = await interceptor.intercept(ctx, makeNext());
    expect(await firstValueFrom(result)).toBe('passthrough');
    expect(isEnabledMock).toHaveBeenCalledWith('read_only_mode');
  });

  it('blocks non-super-admin writes with 503 when the flag is on', async () => {
    isEnabledMock.mockResolvedValue(true);
    platformRolesMaybeSingle.mockResolvedValue({ data: null, error: null });
    const ctx = makeContext({
      url: '/api/v1/admin/organizations',
      method: 'POST',
      headers: { authorization: 'Bearer t' },
    });
    await expect(interceptor.intercept(ctx, makeNext())).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('blocks anonymous writes with 503 when the flag is on (no super-admin escape hatch)', async () => {
    isEnabledMock.mockResolvedValue(true);
    const ctx = makeContext({
      url: '/api/v1/orgs/lyon-amhe/events',
      method: 'PATCH',
      headers: {},
    });
    await expect(interceptor.intercept(ctx, makeNext())).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('lets super-admin writes through when the flag is on', async () => {
    isEnabledMock.mockResolvedValue(true);
    platformRolesMaybeSingle.mockResolvedValue({
      data: { role: 'super_admin' },
      error: null,
    });
    const ctx = makeContext({
      url: '/api/v1/admin/organizations',
      method: 'POST',
      headers: { authorization: 'Bearer t' },
    });
    const result = await interceptor.intercept(ctx, makeNext());
    expect(await firstValueFrom(result)).toBe('passthrough');
  });

  it('reads the bearer token from sb-access-token cookie when no Authorization header is set', async () => {
    isEnabledMock.mockResolvedValue(true);
    platformRolesMaybeSingle.mockResolvedValue({
      data: { role: 'super_admin' },
      error: null,
    });
    const ctx = makeContext({
      url: '/api/v1/admin/users',
      method: 'POST',
      headers: {},
      cookies: { 'sb-access-token': 'cookie-token' },
    });
    const result = await interceptor.intercept(ctx, makeNext());
    expect(await firstValueFrom(result)).toBe('passthrough');
    expect(getAuthUserMock).toHaveBeenCalledWith('cookie-token');
  });
});
