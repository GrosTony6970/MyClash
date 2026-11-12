import { ForbiddenException } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { describe, expect, it, vi } from 'vitest';
import { PLATFORM_ROLE_KEY } from '../admin/guards/platform-role.decorator';
import { PlatformRoleGuard } from '../admin/guards/platform-role.guard';
import {
  ClubSparFlagsController,
  PlatformSparFlagsController,
  flagsQuerySchema,
} from './spar-flag-admin.controller';

const USER = '9a000000-0000-4000-8000-000000000001';
const ORG = 'bb000000-0000-4000-8000-00000000000a';
const FLAG = '7f000000-0000-4000-8000-00000000000f';
const PAGE = { items: [], more: false };

function club(refuse = false) {
  const assertOrgRole = vi.fn(async () => {
    if (refuse) throw new ForbiddenException('Requires admin role or higher');
    return 'admin';
  });
  const flags = { page: vi.fn(async () => PAGE), mark: vi.fn(async () => undefined) };
  const supabase = { getAuthUser: vi.fn(async () => ({ id: USER })) };
  const req = { headers: { authorization: 'Bearer t' } };
  const controller = new ClubSparFlagsController(
    supabase as never,
    { assertOrgRole } as never,
    flags as never,
  );
  return { controller, assertOrgRole, flags, req: req as never };
}

describe('ClubSparFlagsController', () => {
  it('gates on a club admin before it reads, then asks for the page as that user', async () => {
    const { controller, assertOrgRole, flags, req } = club();
    expect(await controller.list(ORG, { page: 3 }, req)).toBe(PAGE);
    expect(assertOrgRole).toHaveBeenCalledWith(ORG, USER, 'admin');
    expect(flags.page).toHaveBeenCalledWith(USER, ORG, 3);
  });

  it('refuses a non-admin with a 403 and reads nothing', async () => {
    const { controller, flags, req } = club(true);
    await expect(controller.list(ORG, { page: 0 }, req)).rejects.toBeInstanceOf(ForbiddenException);
    expect(flags.page).not.toHaveBeenCalled();
  });

  it('marks handled on PUT and not handled on DELETE, in the club’s scope', async () => {
    const { controller, flags, req } = club();
    await controller.handle(ORG, FLAG, req);
    await controller.unhandle(ORG, FLAG, req);
    expect(flags.mark.mock.calls).toEqual([
      [USER, ORG, FLAG, true],
      [USER, ORG, FLAG, false],
    ]);
  });

  it('refuses a non-admin on both writes, with no function call', async () => {
    const { controller, flags, req } = club(true);
    await expect(controller.handle(ORG, FLAG, req)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(controller.unhandle(ORG, FLAG, req)).rejects.toBeInstanceOf(ForbiddenException);
    expect(flags.mark).not.toHaveBeenCalled();
  });
});

describe('PlatformSparFlagsController', () => {
  const flags = { page: vi.fn(async () => PAGE), mark: vi.fn(async () => undefined) };
  const controller = new PlatformSparFlagsController(flags as never);
  const req = { actorUserId: USER } as never;

  it('lists with no club and the actor the guard stamped', async () => {
    expect(await controller.list({ page: 1 }, req)).toBe(PAGE);
    expect(flags.page).toHaveBeenCalledWith(USER, null, 1);
  });

  it('marks in the platform scope', async () => {
    await controller.handle(FLAG, req);
    await controller.unhandle(FLAG, req);
    expect(flags.mark.mock.calls).toEqual([
      [USER, null, FLAG, true],
      [USER, null, FLAG, false],
    ]);
  });

  it('sits behind the platform guard, and the read names super_admin', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, PlatformSparFlagsController)).toContain(
      PlatformRoleGuard,
    );
    expect(Reflect.getMetadata(PLATFORM_ROLE_KEY, controller.list)).toBe('super_admin');
  });
});

describe('flagsQuerySchema', () => {
  it('defaults an omitted page to 0 and takes a non-negative integer', () => {
    expect(flagsQuerySchema.parse({})).toEqual({ page: 0 });
    expect(flagsQuerySchema.parse({ page: '2' })).toEqual({ page: 2 });
  });

  it.each([{ page: '-1' }, { page: '1.5' }, { page: 'x' }, { other: '1' }])(
    'refuses %j',
    (query) => {
      expect(flagsQuerySchema.safeParse(query).success).toBe(false);
    },
  );
});
