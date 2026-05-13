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
    const reporter = vi.fn();
    const error = new Error('async failed');

    logUnhandledRejection(error, logger, reporter);

    expect(logger.error).toHaveBeenCalledWith(
      'Unhandled promise rejection: async failed',
      expect.stringContaining('Error: async failed'),
    );
    expect(reporter).toHaveBeenCalledWith(error, {
      type: 'unhandledRejection',
      message: 'async failed',
    });
  });

  it('logs uncaught exceptions with a stable prefix', () => {
    const logger = { error: vi.fn() };
    const reporter = vi.fn();
    const error = new Error('sync failed');

    logUncaughtException(error, logger, reporter);

    expect(logger.error).toHaveBeenCalledWith(
      'Uncaught exception: sync failed',
      expect.stringContaining('Error: sync failed'),
    );
    expect(reporter).toHaveBeenCalledWith(error, {
      type: 'uncaughtException',
      message: 'sync failed',
    });
  });
});
