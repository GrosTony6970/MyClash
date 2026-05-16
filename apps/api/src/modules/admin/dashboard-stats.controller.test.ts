import { GUARDS_METADATA } from '@nestjs/common/constants';
import { describe, expect, it, vi } from 'vitest';
import { AdminDashboardStatsController } from './dashboard-stats.controller';
import { SuperAdminGuard } from './guards/super-admin.guard';

function controllerGuards(): unknown[] {
  return Reflect.getMetadata(GUARDS_METADATA, AdminDashboardStatsController) ?? [];
}

describe('AdminDashboardStatsController', () => {
  it('protects dashboard stats with SuperAdminGuard', () => {
    expect(controllerGuards()).toContain(SuperAdminGuard);
  });

  it('returns service dashboard stats', async () => {
    const stats = {
      generatedAt: '2026-05-16T12:00:00.000Z',
      organizations: { total: 1, active: 1, suspended: 0 },
    };
    const service = { getStats: vi.fn().mockResolvedValue(stats) };
    const controller = new AdminDashboardStatsController(service as never);

    await expect(controller.getStats()).resolves.toBe(stats);
    expect(service.getStats).toHaveBeenCalledOnce();
  });
});
