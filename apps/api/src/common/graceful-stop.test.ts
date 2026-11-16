import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';

describe('enableGracefulStop', () => {
  it('closes the app on SIGTERM and SIGINT, then exits the process itself', async () => {
    const { enableGracefulStop } = await import('./graceful-stop.js');
    const enableShutdownHooks = vi.fn();
    enableGracefulStop({ enableShutdownHooks } as never, new EventEmitter());
    expect(enableShutdownHooks).toHaveBeenCalledTimes(1);
    expect(enableShutdownHooks).toHaveBeenCalledWith(['SIGTERM', 'SIGINT'], {
      useProcessExit: true,
    });
  });

  it('records the stop when a stop signal comes, and only then (ruling 830)', async () => {
    vi.resetModules();
    const { enableGracefulStop, isStopping } = await import('./graceful-stop.js');
    const signals = new EventEmitter();
    enableGracefulStop({ enableShutdownHooks: vi.fn() } as never, signals);
    expect(isStopping()).toBe(false);
    signals.emit('SIGTERM');
    expect(isStopping()).toBe(true);
  });

  it('importing it adds no signal listener to the process', async () => {
    const before = [process.listenerCount('SIGTERM'), process.listenerCount('SIGINT')];
    vi.resetModules();
    await import('./graceful-stop.js');
    expect([process.listenerCount('SIGTERM'), process.listenerCount('SIGINT')]).toEqual(before);
  });
});
