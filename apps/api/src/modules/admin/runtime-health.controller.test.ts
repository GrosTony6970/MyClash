// runtime-health.controller.test.ts
import { describe, it, expect, vi } from 'vitest';
import { RuntimeHealthAdminController } from './runtime-health.controller';

describe('RuntimeHealthAdminController', () => {
  it('GET / returns the collected snapshot', async () => {
    const health = { collect: vi.fn(async () => ({ overall: 'healthy' })) } as never;
    const settings = {} as never;
    const controller = new RuntimeHealthAdminController(health, settings, {} as never);
    expect(await controller.getRuntimeHealth()).toEqual({ overall: 'healthy' });
  });

  it('PUT /alert-settings forwards the actor id from the request', async () => {
    const updateSettings = vi.fn(async () => ({ enabled: true }));
    const controller = new RuntimeHealthAdminController(
      {} as never,
      { updateSettings } as never,
      {} as never,
    );
    const req = { actorUserId: 'user-1' } as never;
    await controller.updateAlertSettings({ enabled: true } as never, req);
    expect(updateSettings).toHaveBeenCalledWith({ enabled: true }, 'user-1');
  });

  it('GET /series falls back to the default window when hours is not a number', async () => {
    const getSeries = vi.fn(async () => ({ since: 'then', samples: [] }));
    const controller = new RuntimeHealthAdminController(
      {} as never,
      {} as never,
      { getSeries } as never,
    );
    await controller.getSeries('not-a-number');
    expect(getSeries).toHaveBeenCalledWith(24);
  });

  it('GET /series passes a requested window through to the service', async () => {
    const getSeries = vi.fn(async () => ({ since: 'then', samples: [] }));
    const controller = new RuntimeHealthAdminController(
      {} as never,
      {} as never,
      { getSeries } as never,
    );
    await controller.getSeries('6');
    expect(getSeries).toHaveBeenCalledWith(6);
  });
});
