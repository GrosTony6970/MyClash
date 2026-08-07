import { GUARDS_METADATA } from '@nestjs/common/constants';
import { describe, expect, it } from 'vitest';
import { PlatformLogAdminController } from './platform-log.controller';
import { PlatformRoleGuard } from './guards/platform-role.guard';

function controllerGuards(): unknown[] {
  return Reflect.getMetadata(GUARDS_METADATA, PlatformLogAdminController) ?? [];
}

describe('PlatformLogAdminController guards', () => {
  it('protects platform log routes with PlatformRoleGuard', () => {
    expect(controllerGuards()).toContain(PlatformRoleGuard);
  });
});
