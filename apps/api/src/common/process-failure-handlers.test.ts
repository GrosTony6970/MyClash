import { describe, expect, it, vi } from 'vitest';
import {
  describeProcessFailure,
  logUncaughtException,
  logUnhandledRejection,
} from './process-failure-handlers';

describe('process failure handlers', () => {
  it('describes Error instances with stack traces', () => {
    const error = new Error('boom');

    expect(describeProcessFailure(error)).toMatchObject({
      message: 'boom',
      trace: expect.stringContaining('Error: boom'),
    });
  });

  it('describes non-Error rejection values safely', () => {
    expect(describeProcessFailure({ reason: 'bad' })).toEqual({
      message: '{"reason":"bad"}',
    });
  });

  it('logs unhandled rejections with a stable prefix', () => {
    const logger = { error: vi.fn() };

    logUnhandledRejection(new Error('async failed'), logger);

    expect(logger.error).toHaveBeenCalledWith(
      'Unhandled promise rejection: async failed',
      expect.stringContaining('Error: async failed'),
    );
  });

  it('logs uncaught exceptions with a stable prefix', () => {
    const logger = { error: vi.fn() };

    logUncaughtException(new Error('sync failed'), logger);

    expect(logger.error).toHaveBeenCalledWith(
      'Uncaught exception: sync failed',
      expect.stringContaining('Error: sync failed'),
    );
  });
});
