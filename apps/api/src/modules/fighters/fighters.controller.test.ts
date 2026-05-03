import { GUARDS_METADATA } from '@nestjs/common/constants';
import { describe, expect, it } from 'vitest';
import { SuperAdminGuard } from '../admin/guards/super-admin.guard';
import { FightersController } from './fighters.controller';

function guardsFor(methodName: keyof FightersController): unknown[] {
  return Reflect.getMetadata(GUARDS_METADATA, FightersController.prototype[methodName]) ?? [];
}

describe('FightersController merge guards', () => {
  it('protects fighter merge endpoints with SuperAdminGuard', () => {
    expect(guardsFor('merge')).toContain(SuperAdminGuard);
    expect(guardsFor('revertMerge')).toContain(SuperAdminGuard);
    expect(guardsFor('mergeAuditLog')).toContain(SuperAdminGuard);
  });
});
