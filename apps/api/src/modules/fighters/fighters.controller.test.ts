import { GUARDS_METADATA } from '@nestjs/common/constants';
import { UnauthorizedException } from '@nestjs/common';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { PlatformRoleGuard } from '../admin/guards/platform-role.guard';
import { FightersController, GlobalPersonsController } from './fighters.controller';
import { isPlatformStaff } from '../../common/auth/platform-role';

vi.mock('../../common/auth/platform-role', () => ({
  isPlatformStaff: vi.fn(),
  resolvePlatformRole: vi.fn(),
  hasPlatformTier: vi.fn(),
  assertPlatformTier: vi.fn(),
}));

function guardsFor(methodName: keyof FightersController): unknown[] {
  return Reflect.getMetadata(GUARDS_METADATA, FightersController.prototype[methodName]) ?? [];
}

function globalPersonGuardsFor(methodName: keyof GlobalPersonsController): unknown[] {
  return Reflect.getMetadata(GUARDS_METADATA, GlobalPersonsController.prototype[methodName]) ?? [];
}

function fighterThrottleLimit(methodName: keyof FightersController): unknown {
  return Reflect.getMetadata('THROTTLER:LIMITglobal', FightersController.prototype[methodName]);
}

function globalPersonThrottleLimit(methodName: keyof GlobalPersonsController): unknown {
  return Reflect.getMetadata(
    'THROTTLER:LIMITglobal',
    GlobalPersonsController.prototype[methodName],
  );
}

describe('FightersController merge guards', () => {
  it('protects fighter merge endpoints with PlatformRoleGuard', () => {
    expect(guardsFor('merge')).toContain(PlatformRoleGuard);
    expect(guardsFor('revertMerge')).toContain(PlatformRoleGuard);
    expect(guardsFor('mergeAuditLog')).toContain(PlatformRoleGuard);
  });

  it('uses a higher read limit for the merge audit grid', () => {
    expect(fighterThrottleLimit('mergeAuditLog')).toBe(600);
  });
});

describe('GlobalPersonsController guards', () => {
  it('protects global profile edits with PlatformRoleGuard', () => {
    expect(globalPersonGuardsFor('update')).toContain(PlatformRoleGuard);
  });

  it('uses a catalog read limit for global profile searches', () => {
    expect(globalPersonThrottleLimit('list')).toBe(300);
  });
});

/**
 * The person picker is not public, and cannot rely on the global AuthGuard to
 * say so: AUTH_GUARD_MODE defaults to `shadow`, where the guard logs
 * "would-401" and returns true. Anonymous rejection has to happen here.
 */
describe('GlobalPersonsController.list access', () => {
  const listGlobalPersons = vi.fn().mockResolvedValue([]);
  const fighters = { listGlobalPersons } as unknown as never;
  const supabase = {} as never;

  function controller() {
    return new GlobalPersonsController(fighters, supabase);
  }

  function requestWith(identity: unknown) {
    return { identity } as never;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    listGlobalPersons.mockResolvedValue([]);
  });

  it('rejects an anonymous caller even though the route has no @Public()', async () => {
    await expect(
      controller().list({} as never, requestWith({ kind: 'anonymous' })),
    ).rejects.toThrow(UnauthorizedException);
    expect(listGlobalPersons).not.toHaveBeenCalled();
  });

  it('rejects a request carrying no identity at all', async () => {
    // getIdentity falls back to ANONYMOUS when the guard never ran.
    await expect(controller().list({} as never, {} as never)).rejects.toThrow(
      UnauthorizedException,
    );
    expect(listGlobalPersons).not.toHaveBeenCalled();
  });

  it('withholds contact PII from a signed-in caller who is not platform staff', async () => {
    vi.mocked(isPlatformStaff).mockResolvedValue(false);

    await controller().list(
      {} as never,
      requestWith({ kind: 'claimed', userId: 'u1', email: null }),
    );

    expect(listGlobalPersons).toHaveBeenCalledWith({}, { includeContactPii: false });
  });

  it('includes contact PII for platform staff', async () => {
    vi.mocked(isPlatformStaff).mockResolvedValue(true);

    await controller().list(
      {} as never,
      requestWith({ kind: 'claimed', userId: 'u1', email: null }),
    );

    expect(listGlobalPersons).toHaveBeenCalledWith({}, { includeContactPii: true });
  });

  it('never looks up a platform role for a guest or staff token', async () => {
    // Neither carries a user id, so a lookup would be meaningless — and passing
    // a non-user sentinel into .eq('user_id', ...) is the trap platform-role.ts
    // exists to prevent.
    await controller().list(
      {} as never,
      requestWith({ kind: 'staff', staffId: 's1', eventId: 'e1' }),
    );

    expect(isPlatformStaff).not.toHaveBeenCalled();
    expect(listGlobalPersons).toHaveBeenCalledWith({}, { includeContactPii: false });
  });
});
