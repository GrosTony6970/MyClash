import { describe, expect, it, vi } from 'vitest';
import { OpsAgentTraceReader } from './agent-trace-reader';

const STATE = {
  config: 'configured',
  checkedAt: '2026-11-20T12:00:00.000Z',
  lastKeys: ['containers:web-public'],
  lastFiredAt: '2026-11-20T11:55:00.000Z',
  lastStatus: 200,
};

describe('OpsAgentTraceReader.readWake', () => {
  it('reads the worker wake state from its own key', async () => {
    const get = vi.fn(async () => JSON.stringify(STATE));
    expect(await new OpsAgentTraceReader({ get }).readWake()).toEqual({ read: 'ok', state: STATE });
    expect(get).toHaveBeenCalledWith('ops-agent:wake-state');
  });

  it('no key yet: not checked', async () => {
    const reader = new OpsAgentTraceReader({ get: async () => null });
    expect(await reader.readWake()).toEqual({ read: 'not_checked' });
  });

  it('a Redis that fails or never answers: unreadable, within its bound (ruling 842)', async () => {
    const refused = new OpsAgentTraceReader({ get: () => Promise.reject(new Error('down')) });
    expect(await refused.readWake()).toEqual({ read: 'unreadable' });
    const hung = new OpsAgentTraceReader({ get: () => new Promise(() => undefined) }, 5);
    expect(await hung.readWake()).toEqual({ read: 'unreadable' });
  });

  it('reads the outside watcher state from its own key (ruling 903)', async () => {
    const watcher = { config: 'configured', checkedAt: 'c', lastOkAt: 'o', failing: false };
    const get = vi.fn(async () => JSON.stringify(watcher));
    const reader = new OpsAgentTraceReader({ get });
    expect(await reader.readWatcher()).toEqual({ read: 'ok', state: watcher });
    expect(get).toHaveBeenCalledWith('ops-agent:watcher-trace');
  });

  it('a value that is not JSON: unreadable', async () => {
    const reader = new OpsAgentTraceReader({ get: async () => 'not json' });
    expect(await reader.readWake()).toEqual({ read: 'unreadable' });
  });
});
