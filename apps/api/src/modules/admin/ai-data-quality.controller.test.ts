import { GUARDS_METADATA } from '@nestjs/common/constants';
import { describe, expect, it } from 'vitest';
import { AIDataQualityController } from './ai-data-quality.controller';
import { PlatformRoleGuard } from './guards/platform-role.guard';
import { PlatformAISettingsController } from './platform-ai-settings.controller';

function guardsFor(controller: object): unknown[] {
  return Reflect.getMetadata(GUARDS_METADATA, controller) ?? [];
}

describe('AI super-admin controller guards', () => {
  it('protects platform AI settings with PlatformRoleGuard', () => {
    expect(guardsFor(PlatformAISettingsController)).toContain(PlatformRoleGuard);
  });

  it('protects data quality routes with PlatformRoleGuard', () => {
    expect(guardsFor(AIDataQualityController)).toContain(PlatformRoleGuard);
  });
});
