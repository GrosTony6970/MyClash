import { GUARDS_METADATA } from '@nestjs/common/constants';
import { describe, expect, it } from 'vitest';
import { BackupsAdminController } from './backups.controller';
import { PlatformRoleGuard } from './guards/platform-role.guard';

function controllerGuards(): unknown[] {
  return Reflect.getMetadata(GUARDS_METADATA, BackupsAdminController) ?? [];
}

describe('BackupsAdminController guards', () => {
  it('protects backup management routes with PlatformRoleGuard', () => {
    expect(controllerGuards()).toContain(PlatformRoleGuard);
  });

  it('exposes backup deletion, restore, and schedule handlers', () => {
    const controller = new BackupsAdminController({} as never);

    expect(typeof controller.deleteBackup).toBe('function');
    expect(typeof controller.restoreBackup).toBe('function');
    expect(typeof controller.getSchedule).toBe('function');
    expect(typeof controller.updateSchedule).toBe('function');
  });
});
