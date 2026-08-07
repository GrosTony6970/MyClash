import { ForbiddenException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  assertPlatformTier,
  hasPlatformTier,
  isPlatformStaff,
  resolvePlatformRole,
} from './platform-role';

const fromMock = vi.fn();
const supabase = { service: { from: fromMock } } as never;

/** A PostgREST chain whose terminal maybeSingle() resolves to `result`. */
function chain(result: unknown) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue(result),
  };
}

function rowFor(role: string | null) {
  return chain({ data: role === null ? null : { role }, error: null });
}

beforeEach(() => {
  vi.clearAllMocks();
  fromMock.mockReturnValue(rowFor(null));
});

describe('resolvePlatformRole', () => {
  it('returns the stored tier', async () => {
    for (const role of ['super_admin', 'platform_admin', 'platform_viewer'] as const) {
      fromMock.mockReturnValueOnce(rowFor(role));
      await expect(resolvePlatformRole(supabase, 'u1')).resolves.toBe(role);
    }
  });

  it('returns null when the user holds no row', async () => {
    await expect(resolvePlatformRole(supabase, 'u1')).resolves.toBeNull();
  });

  it('queries by user_id only — the role is read, not filtered on', async () => {
    const c = rowFor('platform_admin');
    fromMock.mockReturnValueOnce(c);

    await resolvePlatformRole(supabase, 'u1');

    expect(fromMock).toHaveBeenCalledWith('platform_roles');
    expect(c.eq).toHaveBeenCalledTimes(1);
    expect(c.eq).toHaveBeenCalledWith('user_id', 'u1');
  });

  it('rejects an unrecognised role rather than coercing it up', async () => {
    // platform_roles.role only got its CHECK constraint in 0170; a row written
    // before it, or by hand, must resolve to NO authority.
    for (const junk of ['read_only', 'admin', 'Super_Admin', '', 'owner']) {
      fromMock.mockReturnValueOnce(rowFor(junk));
      await expect(resolvePlatformRole(supabase, 'u1')).resolves.toBeNull();
    }
  });

  it('rejects a row with no role at all', async () => {
    fromMock.mockReturnValueOnce(chain({ data: { user_id: 'u1' }, error: null }));
    await expect(resolvePlatformRole(supabase, 'u1')).resolves.toBeNull();
  });

  it('never resolves a tier for the non-user sentinels, and never queries', async () => {
    for (const sentinel of ['', 'anonymous', 'unknown', null, undefined]) {
      await expect(resolvePlatformRole(supabase, sentinel)).resolves.toBeNull();
    }
    expect(fromMock).not.toHaveBeenCalled();
  });

  it('fails closed on a query error instead of throwing', async () => {
    fromMock.mockReturnValueOnce({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockRejectedValue(new Error('relation does not exist')),
    });
    await expect(resolvePlatformRole(supabase, 'u1')).resolves.toBeNull();
  });
});

describe('hasPlatformTier', () => {
  const held = ['super_admin', 'platform_admin', 'platform_viewer'] as const;
  const min = ['super_admin', 'platform_admin', 'platform_viewer'] as const;
  // Rows = held tier, columns = required minimum.
  const expected: Record<string, Record<string, boolean>> = {
    super_admin: { super_admin: true, platform_admin: true, platform_viewer: true },
    platform_admin: { super_admin: false, platform_admin: true, platform_viewer: true },
    platform_viewer: { super_admin: false, platform_admin: false, platform_viewer: true },
  };

  it('covers all nine held/minimum pairs', async () => {
    for (const h of held) {
      for (const m of min) {
        fromMock.mockReturnValueOnce(rowFor(h));
        await expect(hasPlatformTier(supabase, 'u1', m), `${h} >= ${m}`).resolves.toBe(
          expected[h]![m]!,
        );
      }
    }
  });

  it('holding no role satisfies no minimum, not even the lowest', async () => {
    for (const m of min) {
      fromMock.mockReturnValueOnce(rowFor(null));
      await expect(hasPlatformTier(supabase, 'u1', m)).resolves.toBe(false);
    }
  });
});

describe('isPlatformStaff', () => {
  it('is true for every tier and false for nobody else', async () => {
    for (const role of ['super_admin', 'platform_admin', 'platform_viewer'] as const) {
      fromMock.mockReturnValueOnce(rowFor(role));
      await expect(isPlatformStaff(supabase, 'u1')).resolves.toBe(true);
    }
    fromMock.mockReturnValueOnce(rowFor(null));
    await expect(isPlatformStaff(supabase, 'u1')).resolves.toBe(false);
  });
});

describe('assertPlatformTier', () => {
  it('resolves when the tier is held', async () => {
    fromMock.mockReturnValueOnce(rowFor('super_admin'));
    await expect(assertPlatformTier(supabase, 'u1', 'platform_admin')).resolves.toBeUndefined();
  });

  it('throws Forbidden — not Unauthorized — when it is not', async () => {
    fromMock.mockReturnValueOnce(rowFor('platform_viewer'));
    await expect(assertPlatformTier(supabase, 'u1', 'platform_admin')).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('carries the caller-supplied message', async () => {
    fromMock.mockReturnValueOnce(rowFor(null));
    await expect(
      assertPlatformTier(supabase, 'u1', 'super_admin', 'Super admin access required'),
    ).rejects.toThrow('Super admin access required');
  });
});
