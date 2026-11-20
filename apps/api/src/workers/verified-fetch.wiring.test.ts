// Ruling 905: with no call injected, the wake-up and the ping go through `verifiedFetch`, never
// the global `fetch` (which `NODE_TLS_REJECT_UNAUTHORIZED=0` turns unchecked under --dev-certs).
import { describe, expect, it, vi } from 'vitest';
import type { RuntimeHealthResponseDto } from '../modules/admin/dto/runtime-health.dto';
import { OpsAgentWake } from './ops-agent-wake';
import { WatcherPing } from './watcher-ping';

// Hoisted above the imports by vitest: both classes see the mocked module.
const call = vi.hoisted(() => vi.fn(async () => new Response(null, { status: 200 })));
vi.mock('./verified-fetch', () => ({ verifiedFetch: () => call }));

const quiet = { log: () => undefined, warn: () => undefined };
const redis = { get: async () => null, set: async () => 'OK' };

describe('the default call of the wake-up and the ping (ruling 905)', () => {
  it('the wake-up fires through verifiedFetch', async () => {
    call.mockClear();
    const globalFetch = vi.spyOn(globalThis, 'fetch');
    const wake = new OpsAgentWake({
      env: { OPS_AGENT_WAKE_URL: 'https://fire.example/x', OPS_AGENT_WAKE_TOKEN: 't' },
      logger: quiet,
      redis,
      processRole: 'worker',
    });
    const dead = {
      database: { status: 'unavailable' },
      redis: { status: 'healthy' },
      queues: { status: 'healthy' },
      disk: { status: 'healthy' },
      photoStorage: { status: 'not_configured' },
      containers: { status: 'not_configured' },
    } as unknown as RuntimeHealthResponseDto;
    expect(await wake.onSnapshot(dead, 1_000)).toBe('fired');
    expect(call).toHaveBeenCalledOnce();
    expect(globalFetch).not.toHaveBeenCalled();
    globalFetch.mockRestore();
  });

  it('the ping goes through verifiedFetch', async () => {
    call.mockClear();
    const ping = new WatcherPing({
      env: { OPS_AGENT_WATCHER_PING_URL: 'https://hc-ping.example/uuid' },
      logger: quiet,
      redis,
    });
    expect(await ping.ping(1_000)).toBe('ok');
    expect(call).toHaveBeenCalledWith('https://hc-ping.example/uuid', expect.anything());
  });
});
