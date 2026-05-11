import { GUARDS_METADATA } from '@nestjs/common/constants';
import { describe, expect, it } from 'vitest';
import { AIDataQualityController } from './ai-data-quality.controller';
import { SuperAdminGuard } from './guards/super-admin.guard';
import { PlatformAISettingsController } from './platform-ai-settings.controller';

function guardsFor(controller: object): unknown[] {
  return Reflect.getMetadata(GUARDS_METADATA, controller) ?? [];
}

describe('AI super-admin controller guards', () => {
  it('protects platform AI settings with SuperAdminGuard', () => {
    expect(guardsFor(PlatformAISettingsController)).toContain(SuperAdminGuard);
  });

  it('protects data quality routes with SuperAdminGuard', () => {
    expect(guardsFor(AIDataQualityController)).toContain(SuperAdminGuard);
  });
});
