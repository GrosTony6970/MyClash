import { describe, expect, it, vi } from 'vitest';
import { OpsAgentController } from './ops-agent.controller';

function build() {
  const runtime = { collect: vi.fn().mockResolvedValue({ overall: 'ok' }) };
  const host = { collect: vi.fn().mockResolvedValue({ hostname: 'vps' }) };
  const versions = {
    getSystemVersions: vi.fn().mockResolvedValue({
      generatedAt: 'g',
      deploy: {
        kind: 'deploy',
        previousCommit: 'a',
        deployedCommit: 'b',
        deployedAt: 't',
        deployedBy: 'someone',
        backupFile: 'f',
      },
      groups: [],
    }),
  };
  const backups = {
    getStatus: vi.fn().mockResolvedValue({
      generatedAt: 'g',
      cloudConfigured: false,
      lastBackup: null,
      runningOperation: {
        id: 'o',
        kind: 'backup',
        status: 'running',
        startedAt: 's',
        logTail: ['x'],
      },
    }),
  };
  const tls = { probeAll: vi.fn().mockResolvedValue({ minDays: 40 }) };
  const controller = new OpsAgentController(
    runtime as never,
    host as never,
    versions as never,
    backups as never,
    tls as never,
  );
  return { controller, runtime, host, versions, backups, tls };
}

describe('OpsAgentController', () => {
  it('passes runtime health, host facts and certificates through unchanged', async () => {
    const { controller, runtime, host, tls } = build();
    await expect(controller.runtimeHealth()).resolves.toEqual({ overall: 'ok' });
    await expect(controller.host()).resolves.toEqual({ hostname: 'vps' });
    await expect(controller.tls()).resolves.toEqual({ minDays: 40 });
    expect(runtime.collect).toHaveBeenCalledTimes(1);
    expect(host.collect).toHaveBeenCalledTimes(1);
    expect(tls.probeAll).toHaveBeenCalledTimes(1);
  });

  it('masks versions and backups on the way out', async () => {
    const { controller, versions, backups } = build();
    const v = await controller.versions();
    const b = await controller.backups();
    expect(versions.getSystemVersions).toHaveBeenCalledTimes(1);
    expect(backups.getStatus).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(v)).not.toContain('someone');
    expect(JSON.stringify(b)).not.toContain('logTail');
  });
});
