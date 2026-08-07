// runtime-health-monitor.worker.test.ts
import { describe, it, expect, vi } from 'vitest';
import { RuntimeHealthMonitorWorker } from './runtime-health-monitor.worker';
import { DEFAULT_ALERT_SETTINGS } from '../modules/admin/dto/runtime-health.dto';

function makeDeps(opts: {
  settings?: Partial<typeof DEFAULT_ALERT_SETTINGS>;
  snapshot: Record<string, { status: string }>;
  state?: Record<string, unknown> | null;
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
  const worker = new RuntimeHealthMonitorWorker(
    { add: async () => undefined } as never, // queue (onModuleInit not exercised here)
    { collect: async () => ({ checkedAt: 'now', overall: 'healthy', ...opts.snapshot }) } as never,
    {
      getSettings: async () => ({
        ...DEFAULT_ALERT_SETTINGS,
        recipientEmails: ['ops@x.io'],
        ...opts.settings,
      }),
    } as never,
    samples as never,
    mail as never,
    redis as never,
  );
  return { worker, mail, store, samples };
}

const healthy = {
  database: { status: 'healthy' },
  redis: { status: 'healthy' },
  queues: { status: 'healthy' },
  disk: { status: 'healthy' },
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
