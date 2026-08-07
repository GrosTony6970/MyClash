import { GUARDS_METADATA } from '@nestjs/common/constants';
import { describe, expect, it } from 'vitest';
import { AuditLogAdminController } from './audit-log.controller';
import { PlatformRoleGuard } from './guards/platform-role.guard';

function controllerGuards(): unknown[] {
  return Reflect.getMetadata(GUARDS_METADATA, AuditLogAdminController) ?? [];
}

describe('AuditLogAdminController guards', () => {
  it('protects audit log routes with PlatformRoleGuard', () => {
    expect(controllerGuards()).toContain(PlatformRoleGuard);
  });
});
