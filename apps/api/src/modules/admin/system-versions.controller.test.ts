import { GUARDS_METADATA } from '@nestjs/common/constants';
import { describe, expect, it } from 'vitest';
import { PlatformRoleGuard } from './guards/platform-role.guard';
import { SystemVersionsAdminController } from './system-versions.controller';

function controllerGuards(): unknown[] {
  return Reflect.getMetadata(GUARDS_METADATA, SystemVersionsAdminController) ?? [];
}

describe('SystemVersionsAdminController guards', () => {
  it('protects system version routes with PlatformRoleGuard', () => {
    expect(controllerGuards()).toContain(PlatformRoleGuard);
  });
});
