import { GUARDS_METADATA } from '@nestjs/common/constants';
import { describe, expect, it } from 'vitest';
import { SuperAdminGuard } from '../admin/guards/super-admin.guard';
import { ClubsController } from './clubs.controller';

describe('ClubsController', () => {
  it('uses a catalog read limit for club searches', () => {
    expect(Reflect.getMetadata('THROTTLER:LIMITglobal', ClubsController.prototype.list)).toBe(300);
  });

  it('guards club deletion with SuperAdminGuard', () => {
    const guards = Reflect.getMetadata(GUARDS_METADATA, ClubsController.prototype.delete) as
      | unknown[]
      | undefined;

    expect(guards).toContain(SuperAdminGuard);
  });

  it('guards club logo upload with SuperAdminGuard', () => {
    const guards = Reflect.getMetadata(GUARDS_METADATA, ClubsController.prototype.uploadLogo) as
      | unknown[]
      | undefined;

    expect(guards).toContain(SuperAdminGuard);
  });
});
