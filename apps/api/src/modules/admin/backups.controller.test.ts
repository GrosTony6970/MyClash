import { GUARDS_METADATA } from '@nestjs/common/constants';
import { describe, expect, it } from 'vitest';
import { BackupsAdminController } from './backups.controller';
import { SuperAdminGuard } from './guards/super-admin.guard';

function controllerGuards(): unknown[] {
  return Reflect.getMetadata(GUARDS_METADATA, BackupsAdminController) ?? [];
}

describe('BackupsAdminController guards', () => {
  it('protects backup management routes with SuperAdminGuard', () => {
    expect(controllerGuards()).toContain(SuperAdminGuard);
  });

  it('exposes backup deletion and restore handlers', () => {
    const controller = new BackupsAdminController({} as never);

    expect(typeof controller.deleteBackup).toBe('function');
    expect(typeof controller.restoreBackup).toBe('function');
  });
});
