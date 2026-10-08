import { ServiceUnavailableException } from '@nestjs/common';
import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { firstValueFrom, of } from 'rxjs';
import { ReadOnlyInterceptor } from './read-only.interceptor';
import { OperationalUnavailableException } from '../operational-exception';

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

  // Operator ruling 334: the refusal keeps its words and carries its own code, so a screen
  // says the maintenance in the reader's language. It was a plain 503, whose words the
  // exception filter replaces: a web page read "Internal server error".
  it('refuses with the read-only code and a sentence a screen may show', async () => {
    isEnabledMock.mockResolvedValue(true);
    const ctx = makeContext({ url: '/api/v1/pools/p-1', method: 'PATCH', headers: {} });
    const refusal = await interceptor.intercept(ctx, makeNext()).catch((err: unknown) => err);
    expect(refusal).toBeInstanceOf(OperationalUnavailableException);
    expect((refusal as OperationalUnavailableException).getResponse()).toEqual({
      code: 'read_only_mode',
      message: 'MyClash is in maintenance. Nothing can be saved for now. Try again later.',
    });
  });

  // Operator ruling 336: a PIN signs in and out of a pad during read-only mode, as an
  // account already does. Every other save of a pad stays refused.
  it.each(['/api/v1/staff-auth/login', '/api/v1/staff-auth/logout'])(
    'lets a pad’s PIN through: POST %s',
    async (url) => {
      isEnabledMock.mockResolvedValue(true);
      const ctx = makeContext({ url, method: 'POST', headers: {} });
      const result = await interceptor.intercept(ctx, makeNext());
      expect(await firstValueFrom(result)).toBe('passthrough');
    },
  );

  // Operator ruling 339: the pad's beat tells the Live board how many hits the pad holds.
  // Refused, the board kept the numbers of the last beat before the switch: "0 hits
  // waiting" and a green dot over a pad that held six.
  it('lets a pad’s beat through: POST /api/v1/staff/heartbeat', async () => {
    isEnabledMock.mockResolvedValue(true);
    const ctx = makeContext({ url: '/api/v1/staff/heartbeat', method: 'POST', headers: {} });
    const result = await interceptor.intercept(ctx, makeNext());
    expect(await firstValueFrom(result)).toBe('passthrough');
  });

  it.each(['/api/v1/staff/checkin/scan', '/api/v1/matches/m-1/clock'])(
    'still refuses a pad’s save: POST %s',
    async (url) => {
      isEnabledMock.mockResolvedValue(true);
      const ctx = makeContext({ url, method: 'POST', headers: {} });
      await expect(interceptor.intercept(ctx, makeNext())).rejects.toBeInstanceOf(
        OperationalUnavailableException,
      );
    },
  );

  // `auth/` passes whole, for the sign-in. A sign-up is refused by its own door, not here
  // (operator ruling 341, `assertNotReadOnly`).
  it.each(['/api/v1/auth/public-login', '/api/v1/health', '/api/v1/public/feature-flags'])(
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
