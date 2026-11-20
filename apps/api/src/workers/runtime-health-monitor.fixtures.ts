// The monitor's test doubles: a real wake-up and a real ping over one in-memory Redis.
import { vi } from 'vitest';
import { DEFAULT_ALERT_SETTINGS } from '../modules/admin/dto/runtime-health.dto';
import { OpsAgentWake } from './ops-agent-wake';
import { RuntimeHealthMonitorWorker } from './runtime-health-monitor.worker';
import { WatcherPing } from './watcher-ping';

interface DepsOptions {
  settings?: Partial<typeof DEFAULT_ALERT_SETTINGS>;
  snapshot: Record<string, { status: string }>;
  state?: Record<string, unknown> | null;
  stopping?: () => boolean;
  /** The wake-up's keys; none by default (not configured). */
  wakeEnv?: Record<string, string>;
  /** The outside watcher's ping URL; none by default. */
  pingEnv?: Record<string, string>;
}

type FakeRedis = {
  get(k: string): Promise<string | null>;
  set(k: string, v: string): Promise<void>;
};

const quiet = { log: () => undefined, warn: () => undefined };

/** The real wake-up and ping, each over a fetch spy: `fire` and `pingFetch`. */
function agentWires(redis: FakeRedis, opts: DepsOptions) {
  const fire = vi.fn<typeof fetch>(async () => new Response('{}', { status: 200 }));
  const pingFetch = vi.fn<typeof fetch>(async () => new Response('OK', { status: 200 }));
  const env = opts.wakeEnv ?? {};
  const wake = new OpsAgentWake({
    env,
    logger: quiet,
    redis,
    processRole: 'worker',
    fetchFn: fire,
  });
  const watcher = new WatcherPing({
    env: opts.pingEnv ?? {},
    logger: quiet,
    redis,
    fetchFn: pingFetch,
  });
  return { fire, pingFetch, wake, watcher };
}

export function makeDeps(opts: DepsOptions) {
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
  const { fire, pingFetch, wake, watcher } = agentWires(redis, opts);
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
    watcher,
    redis as never,
  );
  return { worker, mail, store, samples, collect, fire, pingFetch };
}

export const healthy = {
  database: { status: 'healthy' },
  redis: { status: 'healthy' },
  queues: { status: 'healthy' },
  disk: { status: 'healthy' },
  photoStorage: { status: 'not_configured' },
  containers: { status: 'healthy' },
};
