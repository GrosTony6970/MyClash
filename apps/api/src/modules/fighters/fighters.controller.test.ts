import { GUARDS_METADATA } from '@nestjs/common/constants';
import { describe, expect, it } from 'vitest';
import { PlatformRoleGuard } from '../admin/guards/platform-role.guard';
import { FightersController, GlobalPersonsController } from './fighters.controller';

function guardsFor(methodName: keyof FightersController): unknown[] {
  return Reflect.getMetadata(GUARDS_METADATA, FightersController.prototype[methodName]) ?? [];
}

function globalPersonGuardsFor(methodName: keyof GlobalPersonsController): unknown[] {
  return Reflect.getMetadata(GUARDS_METADATA, GlobalPersonsController.prototype[methodName]) ?? [];
}

function fighterThrottleLimit(methodName: keyof FightersController): unknown {
  return Reflect.getMetadata('THROTTLER:LIMITglobal', FightersController.prototype[methodName]);
}

function globalPersonThrottleLimit(methodName: keyof GlobalPersonsController): unknown {
  return Reflect.getMetadata(
    'THROTTLER:LIMITglobal',
    GlobalPersonsController.prototype[methodName],
  );
}

describe('FightersController merge guards', () => {
  it('protects fighter merge endpoints with PlatformRoleGuard', () => {
    expect(guardsFor('merge')).toContain(PlatformRoleGuard);
    expect(guardsFor('revertMerge')).toContain(PlatformRoleGuard);
    expect(guardsFor('mergeAuditLog')).toContain(PlatformRoleGuard);
  });

  it('uses a higher read limit for the merge audit grid', () => {
    expect(fighterThrottleLimit('mergeAuditLog')).toBe(600);
  });
});

describe('GlobalPersonsController guards', () => {
  it('protects global profile edits with PlatformRoleGuard', () => {
    expect(globalPersonGuardsFor('update')).toContain(PlatformRoleGuard);
  });

  it('uses a catalog read limit for global profile searches', () => {
    expect(globalPersonThrottleLimit('list')).toBe(300);
  });
});
