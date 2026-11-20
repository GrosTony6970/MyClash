import { describe, expect, it, vi } from 'vitest';
import { WatcherPing } from './watcher-ping';

const PING = 'https://hc-ping.com/0000-ping';
const KEY = 'ops-agent:watcher-trace';

function make(env: Record<string, string> = { OPS_AGENT_WATCHER_PING_URL: PING }) {
  const store = new Map<string, string>();
  const redis = { set: vi.fn(async (k: string, v: string) => void store.set(k, v)) };
  const fetchFn = vi.fn(async () => new Response('OK', { status: 200 }));
  const logger = { log: vi.fn(), warn: vi.fn() };
  const ping = new WatcherPing({ env, logger, redis, fetchFn: fetchFn as unknown as typeof fetch });
  const state = () => JSON.parse(store.get(KEY) ?? 'null');
  return { ping, fetchFn, logger, state, redis };
}

describe('WatcherPing (ruling 903)', () => {
  it('GETs the ping URL, bounded, and records the success', async () => {
    const { ping, fetchFn, state } = make();
    expect(await ping.ping(1_000)).toBe('ok');
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(PING);
    expect(init.method).toBe('GET');
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(state()).toEqual({
      config: 'configured',
      checkedAt: new Date(1_000).toISOString(),
      lastOkAt: new Date(1_000).toISOString(),
      failing: false,
    });
  });

  it('no URL: no call, and the card learns it is not configured', async () => {
    const { ping, fetchFn, state } = make({});
    expect(await ping.ping(1_000)).toBe('not_configured');
    expect(fetchFn).not.toHaveBeenCalled();
    expect(state()).toMatchObject({ config: 'not_configured' });
  });

  it('a ping that throws or answers non-2xx never throws; failing, the last success kept', async () => {
    const { ping, fetchFn, state } = make();
    await ping.ping(1_000);
    fetchFn.mockRejectedValueOnce(new Error('ENOTFOUND'));
    expect(await ping.ping(2_000)).toBe('failed');
    expect(state()).toMatchObject({ failing: true, lastOkAt: new Date(1_000).toISOString() });
    fetchFn.mockResolvedValueOnce(new Response('', { status: 500 }));
    expect(await ping.ping(3_000)).toBe('failed');
  });

  it('two failures in a row log once; the recovery logs once', async () => {
    const { ping, fetchFn, logger } = make();
    fetchFn.mockRejectedValueOnce(new Error('x')).mockRejectedValueOnce(new Error('x'));
    await ping.ping(1_000);
    await ping.ping(2_000);
    expect(logger.warn).toHaveBeenCalledTimes(1);
    await ping.ping(3_000);
    expect(logger.log).toHaveBeenCalledWith('outside watcher: the ping answers again');
  });

  it('a Redis that never answers the state write does not hold the tick', async () => {
    vi.useFakeTimers();
    try {
      const { ping, redis } = make();
      redis.set.mockImplementation(() => new Promise<undefined>(() => undefined));
      const outcome = ping.ping(1_000);
      await vi.advanceTimersByTimeAsync(5_000);
      expect(await outcome).toBe('ok');
    } finally {
      vi.useRealTimers();
    }
  });

  it('never puts the ping URL in the state the console reads', async () => {
    const { ping, state } = make();
    await ping.ping(1_000);
    expect(JSON.stringify(state())).not.toContain('hc-ping');
  });
});
