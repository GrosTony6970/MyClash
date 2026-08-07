import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import type { PlatformRole } from '@myclash/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PlatformRoleGuard } from './platform-role.guard';

const fromMock = vi.fn();
const fetchMock = vi.fn();
const getUserMock = vi.fn();

const mockSupabase = {
  anon: { auth: { getUser: getUserMock } },
  service: { from: fromMock },
};

const mockConfig = {
  get: vi.fn((key: string, fallback?: string) =>
    key === 'SUPABASE_AUTH_INTERNAL_URL' ? 'http://supabase-auth:9999' : fallback,
  ),
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

function platformRoleRow(role: PlatformRole | null) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: role ? { role } : null, error: null }),
  };
}

function mockAuthUser(user: Record<string, unknown>) {
  fetchMock.mockResolvedValue({ ok: true, json: vi.fn().mockResolvedValue(user) });
}

/** A context whose reflector lookup yields `explicit`, for `method`. */
function contextFor(request: unknown) {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => handlerToken,
    getClass: () => classToken,
  } as unknown as ExecutionContext;
}

const handlerToken = function handler() {};
const classToken = class Controller {};

/** Stands in for Reflector: returns the handler value, else the class value. */
function reflectorReturning(onHandler?: string, onClass?: string) {
  return {
    getAllAndOverride: vi.fn((_key: string, targets: unknown[]) =>
      targets[0] === handlerToken && onHandler !== undefined ? onHandler : onClass,
    ),
  };
}

function makeGuard(onHandler?: string, onClass?: string) {
  return new PlatformRoleGuard(
    mockSupabase as never,
    mockConfig as never,
    reflectorReturning(onHandler, onClass) as never,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', fetchMock);
  fromMock.mockReturnValue(platformRoleRow(null));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ── The matrix ───────────────────────────────────────────────────────────────
// 3 tiers × {GET, POST} × {no decorator, admin, super}. This is the whole
// contract of the guard; everything else in the file is an edge case.

type Decorator = undefined | 'platform_admin' | 'super_admin';

const MATRIX: Array<[PlatformRole, 'GET' | 'POST', Decorator, boolean]> = [
  // ── reads: open to every tier, unless the decorator says super_admin ──────
  ['super_admin', 'GET', undefined, true],
  ['platform_admin', 'GET', undefined, true],
  ['platform_viewer', 'GET', undefined, true],
  // 'platform_admin' on a READ is a documented NO-OP — a viewer still passes.
  ['super_admin', 'GET', 'platform_admin', true],
  ['platform_admin', 'GET', 'platform_admin', true],
  ['platform_viewer', 'GET', 'platform_admin', true],
  ['super_admin', 'GET', 'super_admin', true],
  ['platform_admin', 'GET', 'super_admin', false],
  ['platform_viewer', 'GET', 'super_admin', false],
  // ── writes: super-admin by default, opened one tier by the decorator ──────
  ['super_admin', 'POST', undefined, true],
  ['platform_admin', 'POST', undefined, false],
  ['platform_viewer', 'POST', undefined, false],
  ['super_admin', 'POST', 'platform_admin', true],
  ['platform_admin', 'POST', 'platform_admin', true],
  ['platform_viewer', 'POST', 'platform_admin', false],
  ['super_admin', 'POST', 'super_admin', true],
  ['platform_admin', 'POST', 'super_admin', false],
  ['platform_viewer', 'POST', 'super_admin', false],
];

describe('PlatformRoleGuard — tier matrix', () => {
  it.each(MATRIX)(
    '%s + %s + @PlatformRole(%s) → allowed=%s',
    async (held, method, dec, allowed) => {
      mockAuthUser({ id: 'u1', app_metadata: {} });
      fromMock.mockReturnValue(platformRoleRow(held));
      const guard = makeGuard(dec, undefined);
      const request = { method, headers: { authorization: 'Bearer t' } };

      if (allowed) {
        await expect(guard.canActivate(contextFor(request))).resolves.toBe(true);
      } else {
        await expect(guard.canActivate(contextFor(request))).rejects.toThrow(ForbiddenException);
      }
    },
  );

  it('never lets a platform viewer through a write, whatever the decorator', async () => {
    for (const dec of [undefined, 'platform_admin', 'super_admin'] as Decorator[]) {
      for (const method of ['POST', 'PATCH', 'PUT', 'DELETE']) {
        vi.clearAllMocks();
        mockAuthUser({ id: 'u1', app_metadata: {} });
        fromMock.mockReturnValue(platformRoleRow('platform_viewer'));
        const guard = makeGuard(dec, undefined);
        await expect(
          guard.canActivate(contextFor({ method, headers: { authorization: 'Bearer t' } })),
          `${method} with @PlatformRole(${String(dec)})`,
        ).rejects.toThrow(ForbiddenException);
      }
    }
  });

  it('lets a handler decorator override the class decorator', async () => {
    mockAuthUser({ id: 'u1', app_metadata: {} });
    fromMock.mockReturnValue(platformRoleRow('platform_admin'));
    // class says super_admin, handler says platform_admin → handler wins
    const guard = makeGuard('platform_admin', 'super_admin');
    await expect(
      guard.canActivate(contextFor({ method: 'POST', headers: { authorization: 'Bearer t' } })),
    ).resolves.toBe(true);
  });
});

describe('PlatformRoleGuard — request stamps', () => {
  it('stamps BOTH actorUserId and platformRole', async () => {
    mockAuthUser({ id: 'admin-123', app_metadata: {} });
    fromMock.mockReturnValue(platformRoleRow('platform_admin'));
    const request = { method: 'GET', headers: { authorization: 'Bearer t' } };

    await expect(makeGuard().canActivate(contextFor(request))).resolves.toBe(true);

    // actorUserId is the audit-poisoning regression guard: getActorId() throws
    // without it, so every audit write on the route would 500.
    expect(request).toMatchObject({ actorUserId: 'admin-123', platformRole: 'platform_admin' });
  });
});

describe('PlatformRoleGuard — authentication', () => {
  it('rejects a missing token before touching the database', async () => {
    await expect(
      makeGuard().canActivate(contextFor({ method: 'GET', headers: {} })),
    ).rejects.toThrow(UnauthorizedException);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(fromMock).not.toHaveBeenCalled();
  });

  it('rejects an invalid token before touching the database', async () => {
    fetchMock.mockResolvedValue({ ok: false, json: vi.fn().mockResolvedValue({}) });
    await expect(
      makeGuard().canActivate(
        contextFor({ method: 'GET', headers: { authorization: 'Bearer x' } }),
      ),
    ).rejects.toThrow(UnauthorizedException);
    expect(fromMock).not.toHaveBeenCalled();
  });

  it('accepts the cookie as well as the bearer header', async () => {
    mockAuthUser({ id: 'u1', app_metadata: {} });
    fromMock.mockReturnValue(platformRoleRow('platform_viewer'));
    await expect(
      makeGuard().canActivate(
        contextFor({ method: 'GET', headers: {}, cookies: { 'sb-access-token': 'tok' } }),
      ),
    ).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://supabase-auth:9999/user',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer tok' }),
      }),
    );
  });

  it('refuses an authenticated user who holds no platform role', async () => {
    mockAuthUser({ id: 'nobody', app_metadata: {} });
    await expect(
      makeGuard().canActivate(
        contextFor({ method: 'GET', headers: { authorization: 'Bearer t' } }),
      ),
    ).rejects.toThrow(ForbiddenException);
  });
});

describe('PlatformRoleGuard — bootstrap fallback', () => {
  it('honours app_metadata.role=super_admin when platform_roles is unreachable', async () => {
    // Kept from SuperAdminGuard: SQL is_super_admin() honours the same claim,
    // and bootstrap-super-admin.mjs relies on it to create the first account.
    mockAuthUser({ id: 'boot', app_metadata: { role: 'super_admin' } });
    fromMock.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockRejectedValue(new Error('relation does not exist')),
    });

    await expect(
      makeGuard().canActivate(
        contextFor({ method: 'POST', headers: { authorization: 'Bearer t' } }),
      ),
    ).resolves.toBe(true);
  });

  it('does NOT honour a claim for the lower tiers', async () => {
    // There is no JWT claim for platform_admin or platform_viewer, and there
    // must not be — they exist only as table rows. A forged claim buys nothing.
    for (const role of ['platform_admin', 'platform_viewer']) {
      vi.clearAllMocks();
      mockAuthUser({ id: 'forged', app_metadata: { role } });
      fromMock.mockReturnValue(platformRoleRow(null));
      await expect(
        makeGuard().canActivate(
          contextFor({ method: 'GET', headers: { authorization: 'Bearer t' } }),
        ),
        role,
      ).rejects.toThrow(ForbiddenException);
    }
  });

  it('prefers the stored row over the claim', async () => {
    // A demoted super-admin whose old JWT still carries the claim must NOT be
    // able to write: the row is the source of truth whenever it exists.
    mockAuthUser({ id: 'demoted', app_metadata: { role: 'super_admin' } });
    fromMock.mockReturnValue(platformRoleRow('platform_viewer'));
    await expect(
      makeGuard().canActivate(
        contextFor({ method: 'POST', headers: { authorization: 'Bearer t' } }),
      ),
    ).rejects.toThrow(ForbiddenException);
  });
});
