// runtime-health.controller.test.ts
import { describe, it, expect, vi } from 'vitest';
import { RuntimeHealthAdminController } from './runtime-health.controller';

describe('RuntimeHealthAdminController', () => {
  it('GET / returns the collected snapshot', async () => {
    const health = { collect: vi.fn(async () => ({ overall: 'healthy' })) } as never;
    const settings = {} as never;
    const controller = new RuntimeHealthAdminController(health, settings);
    expect(await controller.getRuntimeHealth()).toEqual({ overall: 'healthy' });
  });

  it('PUT /alert-settings forwards the actor id from the request', async () => {
    const updateSettings = vi.fn(async () => ({ enabled: true }));
    const controller = new RuntimeHealthAdminController({} as never, { updateSettings } as never);
    const req = { actorUserId: 'user-1' } as never;
    await controller.updateAlertSettings({ enabled: true } as never, req);
    expect(updateSettings).toHaveBeenCalledWith({ enabled: true }, 'user-1');
  });
});
