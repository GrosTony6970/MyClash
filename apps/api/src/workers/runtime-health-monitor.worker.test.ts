// runtime-health-monitor.worker.test.ts
import { describe, it, expect, vi } from 'vitest';
import { isStopping } from '../common/graceful-stop';
import { OpsAgentWake } from './ops-agent-wake';
import { RuntimeHealthMonitorWorker } from './runtime-health-monitor.worker';
import { WorkersModule } from './workers.module';
import { DEFAULT_ALERT_SETTINGS } from '../modules/admin/dto/runtime-health.dto';

function makeDeps(opts: {
  settings?: Partial<typeof DEFAULT_ALERT_SETTINGS>;
  snapshot: Record<string, { status: string }>;
  state?: Record<string, unknown> | null;
  stopping?: () => boolean;
  /** The wake-up's keys; none by default (not configured). */
  wakeEnv?: Record<string, string>;
}) {
  const store = new Map<string, string>();
  if (opts.state) store.set('runtime-health:alert-state', JSON.stringify(opts.state));
  const redis = {
    get: async (k: string) => store.get(k) ?? null,
    set: async (k: string, v: string) => void store.set(k, v),
    del: async (k: string) => void store.delete(k),
  };
  const mail = { sendNotification: vi.fn(async () => undefined) };
  const samples = { record: vi.fn(async () => true), prune: vi.fn(async () => 0) };
  const collect = vi.fn(async () => ({ checkedAt: 'now', overall: 'healthy', ...opts.snapshot }));
  const fire = vi.fn(async () => new Response('{}', { status: 200 }));
  const wake = new OpsAgentWake({
    env: opts.wakeEnv ?? {},
    logger: { log: () => undefined, warn: () => undefined },
    redis,
    processRole: 'worker',
    fetchFn: fire as unknown as typeof fetch,
  });
  const worker = new RuntimeHealthMonitorWorker(
    { add: async () => undefined } as never, // queue (onModuleInit not exercised here)
    { collect } as never,
    {
      getSettings: async () => ({
        ...DEFAULT_ALERT_SETTINGS,
        recipientEmails: ['ops@x.io'],
        ...opts.settings,
      }),
    } as never,
    samples as never,
    mail as never,
    opts.stopping ?? (() => false),
    wake,
    redis as never,
  );
  return { worker, mail, store, samples, collect, fire };
}

const healthy = {
  database: { status: 'healthy' },
  redis: { status: 'healthy' },
  queues: { status: 'healthy' },
  disk: { status: 'healthy' },
  photoStorage: { status: 'not_configured' },
  containers: { status: 'healthy' },
};
const dbCritical = { ...healthy, database: { status: 'critical' } };

describe('RuntimeHealthMonitorWorker.tick', () => {
  it('emails on a new critical metric', async () => {
    const { worker, mail } = makeDeps({ snapshot: dbCritical });
    const result = await worker.tick(Date.now());
    expect(result.emailed).toBe(true);
    expect(mail.sendNotification).toHaveBeenCalledOnce();
  });

  it('does not email a warning when level=critical', async () => {
    const warn = { ...healthy, disk: { status: 'warning' } };
    const { worker, mail } = makeDeps({ snapshot: warn });
    const result = await worker.tick(Date.now());
    expect(result.emailed).toBe(false);
    expect(mail.sendNotification).not.toHaveBeenCalled();
  });

  it('suppresses a repeat email within cooldown for the same critical set', async () => {
    const now = Date.now();
    const { worker, mail } = makeDeps({
      snapshot: dbCritical,
      state: {
        lastCriticalKeys: ['database'],
        lastEmailedAt: now - 60_000,
        lastCheckedAt: now - 60_000,
      },
    });
    const result = await worker.tick(now);
    expect(result.emailed).toBe(false);
    expect(mail.sendNotification).not.toHaveBeenCalled();
  });

  it('skips the check when interval has not elapsed', async () => {
    const now = Date.now();
    const { worker } = makeDeps({
      snapshot: dbCritical,
      settings: { checkIntervalMinutes: 15 },
      state: { lastCriticalKeys: [], lastEmailedAt: 0, lastCheckedAt: now - 60_000 },
    });
    const result = await worker.tick(now);
    expect(result.ran).toBe(false);
  });

  it('re-arms (clears state) when everything returns healthy', async () => {
    const now = Date.now();
    const { worker, store } = makeDeps({
      snapshot: healthy,
      state: {
        lastCriticalKeys: ['database'],
        lastEmailedAt: now - 10_000,
        lastCheckedAt: now - 10_000,
      },
    });
    await worker.tick(now);
    const state = JSON.parse(store.get('runtime-health:alert-state') as string);
    expect(state.lastCriticalKeys).toEqual([]);
  });

  it('emails on an unavailable metric (bucketed at the critical tier)', async () => {
    const unavailable = { ...healthy, database: { status: 'unavailable' } };
    const { worker, mail } = makeDeps({ snapshot: unavailable });
    const result = await worker.tick(Date.now());
    expect(result.emailed).toBe(true);
    expect(mail.sendNotification).toHaveBeenCalledOnce();
    expect(result.criticalKeys).toContain('database');
  });

  it('emails when the photo bucket stops answering', async () => {
    const down = { ...healthy, photoStorage: { status: 'unavailable' } };
    const { worker, mail } = makeDeps({ snapshot: down });
    const result = await worker.tick(Date.now());
    expect(result.emailed).toBe(true);
    expect(result.criticalKeys).toEqual(['photoStorage']);
    expect(mail.sendNotification).toHaveBeenCalledOnce();
  });

  it('emails a dead container, naming the service and its exit code (ruling 900)', async () => {
    const containers = {
      status: 'critical',
      problems: [{ service: 'web-public', state: 'exited', exitCode: 1, health: null }],
    };
    const { worker, mail } = makeDeps({ snapshot: { ...healthy, containers } });
    const result = await worker.tick(Date.now());
    expect(result.criticalKeys).toEqual(['containers']);
    expect(mail.sendNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.stringContaining('containers: critical (web-public exited 1)'),
      }),
    );
  });

  it('stays quiet about a photo bucket that is not configured, at either email level', async () => {
    for (const emailLevel of ['critical', 'warning'] as const) {
      const { worker, mail } = makeDeps({ snapshot: healthy, settings: { emailLevel } });
      const result = await worker.tick(Date.now());
      expect(result.emailed).toBe(false);
      expect(mail.sendNotification).not.toHaveBeenCalled();
    }
  });

  it('fails closed (never emails) when the de-dup store read fails', async () => {
    const mail = { sendNotification: vi.fn(async () => undefined) };
    const redis = {
      get: async () => {
        throw new Error('conn refused');
      },
      set: async () => undefined,
      del: async () => undefined,
    };
    const worker = new RuntimeHealthMonitorWorker(
      { add: async () => undefined } as never,
      { collect: async () => ({ checkedAt: 'now', overall: 'critical', ...dbCritical }) } as never,
      {
        getSettings: async () => ({
          ...DEFAULT_ALERT_SETTINGS,
          recipientEmails: ['ops@x.io'],
        }),
      } as never,
      { record: async () => true, prune: async () => 0 } as never,
      mail as never,
      () => false,
      new OpsAgentWake({ env: {}, logger: console, redis, processRole: 'worker' }),
      redis as never,
    );
    const result = await worker.tick(Date.now());
    expect(result.emailed).toBe(false);
    expect(mail.sendNotification).not.toHaveBeenCalled();
  });

  it('records and prunes a sample on every tick that collects', async () => {
    const { worker, samples } = makeDeps({ snapshot: healthy });
    await worker.tick(Date.now());
    expect(samples.record).toHaveBeenCalledOnce();
    expect(samples.prune).toHaveBeenCalledOnce();
  });

  it('does not record when the tick is throttled before collecting', async () => {
    // A throttled tick never calls collect(), so recording one would write a
    // duplicate of the previous sample and flatten the trend.
    const now = Date.now();
    const { worker, samples } = makeDeps({
      snapshot: healthy,
      state: { lastCriticalKeys: [], lastEmailedAt: 0, lastCheckedAt: now - 60_000 },
    });
    const result = await worker.tick(now);
    expect(result.ran).toBe(false);
    expect(samples.record).not.toHaveBeenCalled();
  });

  it('still alerts when recording the sample fails', async () => {
    // History is worth less than the email this tick exists to send.
    const { worker, mail, samples } = makeDeps({ snapshot: dbCritical });
    samples.record.mockRejectedValueOnce(new Error('insert failed'));
    await expect(worker.tick(Date.now())).resolves.toMatchObject({ emailed: true });
    expect(mail.sendNotification).toHaveBeenCalledOnce();
  });
});

describe('a stopping worker sends no queue alarm (ruling 830)', () => {
  const queuesCritical = { ...healthy, queues: { status: 'critical' } };

  it.each(['critical', 'warning'] as const)(
    'does not collect, record, email or store anything once stopping (email level %s)',
    async (emailLevel) => {
      const { worker, mail, store, samples, collect } = makeDeps({
        snapshot: queuesCritical,
        settings: { emailLevel },
        stopping: () => true,
      });
      await expect(worker.tick(Date.now())).resolves.toMatchObject({ ran: false, emailed: false });
      expect(collect).not.toHaveBeenCalled();
      expect(samples.record).not.toHaveBeenCalled();
      expect(mail.sendNotification).not.toHaveBeenCalled();
      expect(store.size).toBe(0);
    },
  );

  it('a stop that lands while the read runs: nothing recorded, emailed or stored', async () => {
    let stopping = false;
    const deps = makeDeps({ snapshot: queuesCritical, stopping: () => stopping });
    deps.collect.mockImplementationOnce(async () => {
      stopping = true; // the drain closed the idle consumers while the queues were read
      return { checkedAt: 'now', overall: 'critical', ...queuesCritical };
    });
    await expect(deps.worker.tick(Date.now())).resolves.toMatchObject({ ran: false });
    expect(deps.samples.record).not.toHaveBeenCalled();
    expect(deps.mail.sendNotification).not.toHaveBeenCalled();
    expect(deps.store.size).toBe(0);
  });

  it('the worker module gives the monitor the process stop state', () => {
    const providers = Reflect.getMetadata('providers', WorkersModule) as Array<{
      provide?: unknown;
      useFactory?: (...args: unknown[]) => RuntimeHealthMonitorWorker;
    }>;
    const factory = providers.find((p) => p.provide === RuntimeHealthMonitorWorker)?.useFactory;
    const config = { get: (_key: string, fallback?: unknown) => fallback };
    const worker = factory?.({}, {}, {}, {}, {}, config);
    expect((worker as unknown as { isStopping: unknown }).isStopping).toBe(isStopping);
  });
});

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
