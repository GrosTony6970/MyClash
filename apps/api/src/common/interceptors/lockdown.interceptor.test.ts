import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { firstValueFrom, of } from 'rxjs';
import { LockdownInterceptor } from './lockdown.interceptor';
import { OperationalUnavailableException } from '../operational-exception';

interface MockRequest {
  method?: string;
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
    const refusal = await interceptor.intercept(ctx, makeNext()).catch((err: unknown) => err);
    // The sign-in door's own refusal (ruling 308): its words reach the page, and its code too.
    expect(refusal).toBeInstanceOf(OperationalUnavailableException);
    // The words name no audience: a Fighter's save under an Event meets them too (ruling 348).
    expect((refusal as OperationalUnavailableException).getResponse()).toMatchObject({
      code: 'admin_lockdown',
      message: 'MyClash is in maintenance. Try again later.',
    });
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
      OperationalUnavailableException,
    );
    expect(getAuthUserMock).toHaveBeenCalledWith('cookie-token');
  });

  // Operator ruling 327: a read of what the public site and the pad show passes for
  // everybody, a save there is refused, and the admin's own addresses stay locked whole.
  describe('with the lockdown on, for an account that is not platform staff', () => {
    const signedIn = { authorization: 'Bearer t' };

    beforeEach(() => {
      isEnabledMock.mockResolvedValue(true);
      platformRolesMaybeSingle.mockResolvedValue({ data: null, error: null });
    });

    it.each([
      ['GET', '/api/v1/events/fal-2026/my-schedule'],
      ['GET', '/api/v1/tournaments/t-1/match-config'],
      ['GET', '/api/v1/tournaments/t-1/pool-standings?mode=by-pool'],
      ['GET', '/api/v1/leagues/l-1/standings'],
      ['GET', '/api/v1/clubs/lyon-amhe'],
      ['GET', '/api/v1/organizations/public/lyon-amhe'],
      ['GET', '/api/v1/organizations/o-1/events'],
      ['HEAD', '/api/v1/events/fal-2026/pass'],
    ])('lets a read through: %s %s', async (method, url) => {
      const ctx = makeContext({ method, url, headers: signedIn });
      const result = await interceptor.intercept(ctx, makeNext());
      expect(await firstValueFrom(result)).toBe('passthrough');
      expect(isEnabledMock).not.toHaveBeenCalled();
    });

    it.each([
      ['POST', '/api/v1/events/e-1/follows'],
      ['DELETE', '/api/v1/events/e-1/follows/p-1'],
      ['PATCH', '/api/v1/tournaments/t-1'],
      ['PUT', '/api/v1/leagues/l-1/rules'],
      ['POST', '/api/v1/clubs'],
      // Ruling 327a: the club's own addresses, which the list never had.
      ['POST', '/api/v1/organizations/o-1/events'],
      ['PATCH', '/api/v1/organizations/o-1'],
      ['DELETE', '/api/v1/organizations/o-1/members/u-1'],
      ['GET', '/api/v1/admin/users'],
      ['GET', '/api/v1/orgs/o-1/league-requests'],
      ['GET', '/api/v1/global-persons/gp-1'],
    ])('refuses %s %s with the lockdown code', async (method, url) => {
      const ctx = makeContext({ method, url, headers: signedIn });
      const refusal = await interceptor.intercept(ctx, makeNext()).catch((err: unknown) => err);
      expect(refusal).toBeInstanceOf(OperationalUnavailableException);
      expect((refusal as OperationalUnavailableException).getResponse()).toMatchObject({
        code: 'admin_lockdown',
      });
    });
  });
});
