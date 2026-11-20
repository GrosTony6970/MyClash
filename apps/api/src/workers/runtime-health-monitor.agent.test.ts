// The runtime-health tick as the ops agent sees it: the wake-up (rulings 901, 902) and the outside
// watcher's ping (ruling 903).
import { describe, it, expect } from 'vitest';
import { healthy, makeDeps } from './runtime-health-monitor.fixtures';

describe('the wake-up checks on every tick, whatever the email settings (rulings 901, 902)', () => {
  const wakeEnv = { OPS_AGENT_WAKE_URL: 'https://fire.example/x', OPS_AGENT_WAKE_TOKEN: 't' };
  const webPublicDead = (...services: string[]) => ({
    ...healthy,
    containers: {
      status: 'critical',
      problems: services.map((service) => ({
        service,
        state: 'exited',
        exitCode: 1,
        health: null,
      })),
    },
  });
  const notDue = (now: number) => ({ lastCriticalKeys: [], lastEmailedAt: 0, lastCheckedAt: now });

  it('emails off: the tick still reads health and wakes the task', async () => {
    const { worker, collect, fire, mail } = makeDeps({
      snapshot: webPublicDead('web-public'),
      settings: { enabled: false },
      wakeEnv,
    });
    await worker.tick(Date.now());
    expect(collect).toHaveBeenCalledOnce();
    expect(fire).toHaveBeenCalledOnce();
    expect(mail.sendNotification).not.toHaveBeenCalled();
  });

  it('the email check not due: one read, a call, but no email and no sample', async () => {
    const now = Date.now();
    const { worker, collect, fire, mail, samples } = makeDeps({
      snapshot: webPublicDead('web-public'),
      state: notDue(now - 60_000),
      wakeEnv,
    });
    await expect(worker.tick(now)).resolves.toMatchObject({ ran: false });
    expect(collect).toHaveBeenCalledOnce();
    expect(fire).toHaveBeenCalledOnce();
    expect(mail.sendNotification).not.toHaveBeenCalled();
    expect(samples.record).not.toHaveBeenCalled();
  });

  it('not configured and the check not due: no read at all, the card learns it is not configured', async () => {
    const now = Date.now();
    const { worker, collect, store } = makeDeps({ snapshot: healthy, state: notDue(now - 60_000) });
    await worker.tick(now);
    expect(collect).not.toHaveBeenCalled();
    expect(JSON.parse(store.get('ops-agent:wake-state')!)).toMatchObject({
      config: 'not_configured',
    });
  });

  it('a stopping worker: no read, no call', async () => {
    const { worker, collect, fire } = makeDeps({
      snapshot: webPublicDead('web-public'),
      stopping: () => true,
      wakeEnv,
    });
    await worker.tick(Date.now());
    expect(collect).not.toHaveBeenCalled();
    expect(fire).not.toHaveBeenCalled();
  });

  it('a stop that lands during the read: no call, no email (the drain reads queues as dead)', async () => {
    let stopping = false;
    const deps = makeDeps({
      snapshot: { ...healthy, queues: { status: 'critical' } },
      stopping: () => stopping,
      wakeEnv,
    });
    deps.collect.mockImplementationOnce(async () => {
      stopping = true;
      return { checkedAt: 'now', overall: 'critical', ...healthy, queues: { status: 'critical' } };
    });
    await deps.worker.tick(Date.now());
    expect(deps.fire).not.toHaveBeenCalled();
    expect(deps.mail.sendNotification).not.toHaveBeenCalled();
  });

  it('a second service dies while the first is still down: a second call', async () => {
    const deps = makeDeps({ snapshot: webPublicDead('web-public'), wakeEnv });
    await deps.worker.tick(1_000_000);
    deps.collect.mockResolvedValueOnce({
      checkedAt: 'now',
      overall: 'critical',
      ...webPublicDead('web-public', 'web-staff'),
    });
    await deps.worker.tick(1_300_000);
    expect(deps.fire).toHaveBeenCalledTimes(2);
  });
});

describe('each tick pings the outside watcher (ruling 903)', () => {
  const pingEnv = { OPS_AGENT_WATCHER_PING_URL: 'https://hc-ping.example/uuid' };
  const notDue = (now: number) => ({ lastCriticalKeys: [], lastEmailedAt: 0, lastCheckedAt: now });

  it('once per tick, even with emails off and the email check not due', async () => {
    const now = Date.now();
    for (const settings of [{ enabled: false }, {}]) {
      const { worker, pingFetch } = makeDeps({
        snapshot: healthy,
        settings,
        state: notDue(now - 60_000),
        pingEnv,
      });
      await worker.tick(now);
      expect(pingFetch).toHaveBeenCalledOnce();
      expect(String((pingFetch.mock.calls[0] as unknown[])[0])).toBe(
        pingEnv.OPS_AGENT_WATCHER_PING_URL,
      );
    }
  });

  it('a stopping worker does not ping: the watcher sees a deploy as a stop', async () => {
    const { worker, pingFetch } = makeDeps({ snapshot: healthy, stopping: () => true, pingEnv });
    await worker.tick(Date.now());
    expect(pingFetch).not.toHaveBeenCalled();
  });

  it('a ping that fails does not stop the tick: the email and the wake-up still run', async () => {
    const deps = makeDeps({
      snapshot: { ...healthy, database: { status: 'critical' } },
      pingEnv,
      wakeEnv: { OPS_AGENT_WAKE_URL: 'https://fire.example/x', OPS_AGENT_WAKE_TOKEN: 't' },
    });
    deps.pingFetch.mockRejectedValueOnce(new Error('ENOTFOUND'));
    await expect(deps.worker.tick(Date.now())).resolves.toMatchObject({ emailed: true });
    expect(deps.fire).toHaveBeenCalledOnce();
  });
});
