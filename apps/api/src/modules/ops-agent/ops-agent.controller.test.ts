import { describe, expect, it, vi } from 'vitest';
import { AdminSystemActionsService } from '../admin/system-actions.service';
import { AgentLogsService } from './agent-logs.service';
import { OpsAgentController } from './ops-agent.controller';

/** Slice 4's doubles: the live-Event read, the system actions, the backup's trigger. */
function actionDoubles(backups: object) {
  const eventsLive = {
    read: vi.fn().mockResolvedValue({ generatedAt: 'g', live: false, events: [] }),
  };
  const systemActions = {
    runComponentAction: vi.fn().mockResolvedValue({
      ok: true,
      service: 'supabase-rest',
      action: 'restart',
      exitCode: 0,
      stdout: 'marker-out',
      stderr: 'marker-err',
    }),
    renewCertificates: vi.fn().mockResolvedValue({ ok: true, scheduled: true, exitCode: null }),
  };
  Object.assign(backups, {
    triggerBackup: vi.fn().mockResolvedValue({
      operation: { id: 'op', kind: 'backup', status: 'running', startedAt: 's', logTail: ['x'] },
    }),
  });
  return { eventsLive, systemActions };
}

function build() {
  const { runtime, host, versions, backups, tls } = readDoubles();
  const { eventsLive, systemActions } = actionDoubles(backups);
  // The real service over a stub runner: the scrub is the service's, so a double would prove
  // nothing about what the agent reads.
  const runner = { body: {} as unknown };
  const runnerOptions = {
    opsRunnerUrl: 'http://ops-runner:4075',
    opsRunnerSecret: 's',
    fetchImpl: (async () => new Response(JSON.stringify(runner.body))) as unknown as typeof fetch,
  };
  const agentLogs = new AgentLogsService(runnerOptions);
  // The containers read is the system actions' own (ruling 900): the real one, over the same runner.
  const realActions = new AdminSystemActionsService({} as never, runnerOptions);
  Object.assign(systemActions, { getContainers: () => realActions.getContainers() });
  const controller = new OpsAgentController(
    runtime as never,
    host as never,
    versions as never,
    backups as never,
    tls as never,
    agentLogs,
    eventsLive as never,
    systemActions as never,
  );
  return { controller, runtime, host, versions, backups, tls, runner, eventsLive, systemActions };
}

/** The admin services the door's health reads pass through. */
function readDoubles() {
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
  return { runtime, host, versions, backups, tls };
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

  // Slice 4: each action is the key's own account's, in the audit row the service writes.
  it('a container action goes out under the key account, by its UI key, masked', async () => {
    const { controller, systemActions } = build();
    const answer = await controller.containerAction(
      { service: 'supabase-rest', action: 'restart' },
      'agent-user',
    );
    expect(systemActions.runComponentAction).toHaveBeenCalledWith(
      'postgrest',
      'restart',
      'agent-user',
    );
    expect(Object.keys(answer).sort()).toEqual(
      ['action', 'exitCode', 'ok', 'scheduled', 'service', 'timedOut'].sort(),
    );
  });

  it('a backup and a renewal go out under the key account, masked', async () => {
    const { controller, systemActions, backups } = build();
    const started = await controller.runBackup('agent-user');
    expect(
      (backups as unknown as { triggerBackup: ReturnType<typeof vi.fn> }).triggerBackup,
    ).toHaveBeenCalledWith('agent-user');
    expect(JSON.stringify(started)).not.toContain('logTail');
    const renewed = await controller.renewCertificates('agent-user');
    expect(systemActions.renewCertificates).toHaveBeenCalledWith('agent-user');
    expect(renewed).toMatchObject({ service: 'traefik', action: 'renew-certs', scheduled: true });
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
