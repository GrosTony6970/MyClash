import { describe, expect, it, vi } from 'vitest';
import { enableGracefulStop } from './graceful-stop';

describe('enableGracefulStop', () => {
  it('closes the app on SIGTERM and SIGINT, then exits the process itself', () => {
    const enableShutdownHooks = vi.fn();
    enableGracefulStop({ enableShutdownHooks } as never);
    expect(enableShutdownHooks).toHaveBeenCalledTimes(1);
    expect(enableShutdownHooks).toHaveBeenCalledWith(['SIGTERM', 'SIGINT'], {
      useProcessExit: true,
    });
  });
});
