import { describe, expect, it, vi } from 'vitest';
import { HostInfoAdminController } from './host-info.controller';

// Ops agent slice 4b (ruling 897): the console's Free disk space. The guard's default reserves
// the POST to a super admin (platform-role-coverage.test.ts); this holds who the audit row names.
describe('HostInfoAdminController.prune', () => {
  it('prunes under the super admin who asked, and answers what the service answered', async () => {
    const result = {
      ok: true,
      exitCode: 0,
      timedOut: false,
      freedBytes: 1,
      availBytes: 2,
      stderr: '',
    };
    const systemActions = { pruneDisk: vi.fn().mockResolvedValue(result) };
    const controller = new HostInfoAdminController({} as never, systemActions as never);
    await expect(controller.prune({ actorUserId: 'super-admin-1' } as never)).resolves.toBe(result);
    expect(systemActions.pruneDisk).toHaveBeenCalledWith('super-admin-1');
  });
});
