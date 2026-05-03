import { GUARDS_METADATA } from '@nestjs/common/constants';
import { describe, expect, it } from 'vitest';
import { ExchangeEditRequestsAdminController } from './exchange-edit-requests.controller';
import { SuperAdminGuard } from './guards/super-admin.guard';

function controllerGuards(): unknown[] {
  return Reflect.getMetadata(GUARDS_METADATA, ExchangeEditRequestsAdminController) ?? [];
}

describe('ExchangeEditRequestsAdminController guards', () => {
  it('protects frozen-result review routes with SuperAdminGuard', () => {
    expect(controllerGuards()).toContain(SuperAdminGuard);
  });
});
