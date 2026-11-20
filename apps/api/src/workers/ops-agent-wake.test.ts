import { describe, expect, it, vi } from 'vitest';
import { OpsAgentWake, wakeKeys } from './ops-agent-wake';
import type { RuntimeHealthResponseDto } from '../modules/admin/dto/runtime-health.dto';

const URL = 'https://api.anthropic.com/v1/claude_code/routines/trig_x/fire';
const ENV = { OPS_AGENT_WAKE_URL: URL, OPS_AGENT_WAKE_TOKEN: 'tok-secret' };
const STATE_KEY = 'ops-agent:wake-state';

const healthy = {
  checkedAt: 'now',
  overall: 'healthy',
  database: { status: 'healthy' },
  redis: { status: 'healthy' },
  queues: { status: 'healthy' },
  disk: { status: 'healthy', usePercent: 40 },
  photoStorage: { status: 'not_configured' },
  containers: { status: 'healthy', running: 16, total: 16, problems: [] },
} as unknown as RuntimeHealthResponseDto;

const dead = (...services: string[]) =>
  ({
    ...healthy,
    containers: {
      status: 'critical',
      running: 16 - services.length,
      total: 16,
      problems: services.map((service) => ({
        service,
        state: 'exited',
        exitCode: 1,
        health: null,
      })),
    },
  }) as unknown as RuntimeHealthResponseDto;

const diskFull = {
  ...healthy,
  disk: { status: 'critical', usePercent: 93 },
} as unknown as RuntimeHealthResponseDto;

interface MakeOptions {
  env?: Record<string, string>;
  status?: number;
  role?: 'api' | 'worker';
}

function make(opts: MakeOptions = {}) {
  const store = new Map<string, string>();
  const redis = {
    get: vi.fn(async (k: string) => store.get(k) ?? null),
    set: vi.fn(async (k: string, v: string) => void store.set(k, v)),
  };
  const fetchFn = vi.fn(async () => new Response('{}', { status: opts.status ?? 200 }));
  const logger = { log: vi.fn(), warn: vi.fn() };
  const wake = new OpsAgentWake({
    env: opts.env ?? ENV,
    logger,
    redis,
    processRole: opts.role ?? 'worker',
    fetchFn: fetchFn as unknown as typeof fetch,
  });
  const state = () => JSON.parse(store.get(STATE_KEY) ?? 'null');
  return { wake, store, redis, fetchFn, logger, state };
}

describe('OpsAgentWake.onSnapshot (rulings 901, 902)', () => {
  it('a new critical set: ONE call to the fire endpoint, its headers and its text', async () => {
    const { wake, fetchFn, state } = make();
    expect(await wake.onSnapshot(dead('web-public'), 1_000)).toBe('fired');
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(URL);
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({
      authorization: 'Bearer tok-secret',
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'experimental-cc-routine-2026-04-01',
      'content-type': 'application/json',
    });
    expect(JSON.parse(String(init.body))).toEqual({
      text: 'alert containers=critical(web-public exited 1)',
    });
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(state()).toMatchObject({
      config: 'configured',
      lastKeys: ['containers:web-public'],
      lastFiredAt: new Date(1_000).toISOString(),
      lastStatus: 200,
    });
  });

  it('the text carries a figure where one helps: the disk use', async () => {
    const { wake, fetchFn } = make();
    await wake.onSnapshot(diskFull, 1_000);
    const [, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({ text: 'alert disk=critical 93%' });
  });

  it('the same set on the next tick: no call', async () => {
    const { wake, fetchFn } = make();
    await wake.onSnapshot(dead('web-public'), 1_000);
    expect(await wake.onSnapshot(dead('web-public'), 2_000)).toBe('same-set');
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('a second container dies while the first is still down: a second call', async () => {
    const { wake, fetchFn } = make();
    await wake.onSnapshot(dead('web-public'), 1_000);
    expect(await wake.onSnapshot(dead('web-public', 'web-staff'), 2_000)).toBe('fired');
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('one of two problems heals: no call, and the one that heals can call again later', async () => {
    const { wake, fetchFn } = make();
    await wake.onSnapshot(dead('web-public', 'web-staff'), 1_000);
    expect(await wake.onSnapshot(dead('web-public'), 2_000)).toBe('same-set');
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(await wake.onSnapshot(dead('web-public', 'web-staff'), 3_000)).toBe('fired');
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('healthy clears the set (re-arm): the same problem again calls again', async () => {
    const { wake, fetchFn, state } = make();
    await wake.onSnapshot(dead('web-public'), 1_000);
    expect(await wake.onSnapshot(healthy, 2_000)).toBe('cleared');
    expect(state().lastKeys).toEqual([]);
    expect(await wake.onSnapshot(dead('web-public'), 3_000)).toBe('fired');
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('fail-closed: a wake state it cannot read means no call, and no write', async () => {
    const { wake, fetchFn, redis } = make();
    redis.get.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    expect(await wake.onSnapshot(dead('web-public'), 1_000)).toBe('skipped');
    expect(fetchFn).not.toHaveBeenCalled();
    expect(redis.set).not.toHaveBeenCalled();
  });

  it('fail-closed on a Redis that never answers: the read is bounded', async () => {
    vi.useFakeTimers();
    try {
      const { wake, fetchFn, redis } = make();
      redis.get.mockImplementationOnce(() => new Promise(() => undefined));
      const outcome = wake.onSnapshot(dead('web-public'), 1_000);
      await vi.advanceTimersByTimeAsync(5_000);
      expect(await outcome).toBe('skipped');
      expect(fetchFn).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('a paused task (400): failed, the set kept so the next tick does not call again', async () => {
    const { wake, fetchFn, state, logger } = make({ status: 400 });
    expect(await wake.onSnapshot(dead('web-public'), 1_000)).toBe('failed');
    expect(state()).toMatchObject({ lastKeys: ['containers:web-public'], lastStatus: 400 });
    expect(await wake.onSnapshot(dead('web-public'), 2_000)).toBe('same-set');
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith('agent wake-up: the call answered 400');
  });

  it('a call that throws (timeout, network): failed, no status, the set kept', async () => {
    const { wake, fetchFn, state } = make();
    fetchFn.mockRejectedValueOnce(new Error('The operation was aborted due to timeout'));
    expect(await wake.onSnapshot(dead('web-public'), 1_000)).toBe('failed');
    expect(state()).toMatchObject({ lastKeys: ['containers:web-public'], lastStatus: null });
  });

  it('never puts the token in the state the console reads', async () => {
    const { wake, store } = make();
    await wake.onSnapshot(dead('web-public'), 1_000);
    expect(store.get(STATE_KEY)).not.toContain('tok-secret');
    expect(store.get(STATE_KEY)).not.toContain(URL);
  });
});

describe('OpsAgentWake configuration', () => {
  it('no keys: not configured, logged once at the worker boot, never a call', async () => {
    const { wake, fetchFn, logger, state } = make({ env: {} });
    expect(wake.config).toBe('not_configured');
    expect(logger.log).toHaveBeenCalledWith('agent wake-up: not configured');
    await wake.noteUnconfigured(1_000);
    expect(state()).toMatchObject({
      config: 'not_configured',
      checkedAt: new Date(1_000).toISOString(),
    });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('one key without the other: misconfigured, a warning, never a call', () => {
    const halves: Record<string, string>[] = [
      { OPS_AGENT_WAKE_URL: URL },
      { OPS_AGENT_WAKE_TOKEN: 'tok' },
    ];
    for (const env of halves) {
      const { wake, logger } = make({ env });
      expect(wake.config).toBe('misconfigured');
      expect(logger.warn).toHaveBeenCalledTimes(1);
    }
  });

  it('the API process builds the same graph but logs nothing (only the worker ticks)', () => {
    const { logger } = make({ env: {}, role: 'api' });
    expect(logger.log).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
  });
});

describe('wakeKeys', () => {
  it('splits the containers metric per service, and keeps the other metrics whole', () => {
    const both = { ...dead('web-public', 'worker'), database: { status: 'unavailable' } };
    expect(wakeKeys(both as unknown as RuntimeHealthResponseDto)).toEqual([
      'database',
      'containers:web-public',
      'containers:worker',
    ]);
  });

  it('a warning wakes nobody', () => {
    const warn = { ...healthy, disk: { status: 'warning', usePercent: 85 } };
    expect(wakeKeys(warn as unknown as RuntimeHealthResponseDto)).toEqual([]);
  });

  it('containers unavailable (the runner down) is one key', () => {
    const down = { ...healthy, containers: { status: 'unavailable', error: 'x' } };
    expect(wakeKeys(down as unknown as RuntimeHealthResponseDto)).toEqual(['containers']);
  });
});
