import { describe, expect, it, vi } from 'vitest';
import { AgentLogsService } from './agent-logs.service';
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
  const eventsLive = {
    read: vi.fn().mockResolvedValue({ generatedAt: 'g', live: false, events: [] }),
  };
  // The real service over a stub runner: the scrub is the service's, so a double would prove
  // nothing about what the agent reads.
  const runner = { body: {} as unknown };
  const agentLogs = new AgentLogsService({
    opsRunnerUrl: 'http://ops-runner:4075',
    opsRunnerSecret: 's',
    fetchImpl: (async () => new Response(JSON.stringify(runner.body))) as unknown as typeof fetch,
  });
  const controller = new OpsAgentController(
    runtime as never,
    host as never,
    versions as never,
    backups as never,
    tls as never,
    agentLogs,
    eventsLive as never,
  );
  return { controller, runtime, host, versions, backups, tls, runner, eventsLive };
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

  it('withholds the error text of runtime health, host facts and certificates', async () => {
    const { controller, runtime, host, tls } = build();
    runtime.collect.mockResolvedValue({ disk: { status: 'unavailable', error: 'marker-1' } });
    host.collect.mockResolvedValue({ hostname: 'vps', error: 'marker-2' });
    tls.probeAll.mockResolvedValue({ hosts: [{ reachable: false, error: 'marker-3' }] });
    const text = JSON.stringify([
      await controller.runtimeHealth(),
      await controller.host(),
      await controller.tls(),
    ]);
    expect(text).not.toContain('marker');
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

  it('answers the live-Event read of its service as it is', async () => {
    const { controller, eventsLive } = build();
    expect(await controller.eventsLive()).toEqual({ generatedAt: 'g', live: false, events: [] });
    expect(eventsLive.read).toHaveBeenCalledTimes(1);
  });

  it("passes no person's address, phone or full IP in the container reads", async () => {
    const { controller, runner } = build();
    runner.body = {
      generatedAt: 'g',
      containers: [{ name: 'myclash-api', service: 'api', state: 'running', Labels: 'marker-x' }],
    };
    const containers = await controller.containers();
    runner.body = {
      generatedAt: 'g',
      lines: ['to marker@example.com, call 06 12 34 56 78, from 203.0.113.77'],
      truncated: false,
    };
    const log = await controller.log({ service: 'api' }, { lines: 10, errors: false });

    const text = JSON.stringify([containers, log]);
    expect(text).not.toMatch(/marker|06 12 34|203\.0\.113\.77/);
    expect(log.lines).toEqual(['to [redacted-email], call [redacted-phone], from 203.0.x.x']);
  });
});
