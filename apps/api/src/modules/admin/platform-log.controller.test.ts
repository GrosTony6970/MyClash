import { GUARDS_METADATA } from '@nestjs/common/constants';
import { describe, expect, it } from 'vitest';
import { PlatformLogAdminController } from './platform-log.controller';
import { SuperAdminGuard } from './guards/super-admin.guard';

function controllerGuards(): unknown[] {
  return Reflect.getMetadata(GUARDS_METADATA, PlatformLogAdminController) ?? [];
}

describe('PlatformLogAdminController guards', () => {
  it('protects platform log routes with SuperAdminGuard', () => {
    expect(controllerGuards()).toContain(SuperAdminGuard);
  });
});
