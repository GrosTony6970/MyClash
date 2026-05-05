import { GUARDS_METADATA } from '@nestjs/common/constants';
import { describe, expect, it } from 'vitest';
import { SuperAdminGuard } from './guards/super-admin.guard';
import { SystemVersionsAdminController } from './system-versions.controller';

function controllerGuards(): unknown[] {
  return Reflect.getMetadata(GUARDS_METADATA, SystemVersionsAdminController) ?? [];
}

describe('SystemVersionsAdminController guards', () => {
  it('protects system version routes with SuperAdminGuard', () => {
    expect(controllerGuards()).toContain(SuperAdminGuard);
  });
});
