import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  describeProcessFailure,
  FLUSH_BEFORE_EXIT_MS,
  logUncaughtException,
  logUnhandledRejection,
  onUncaughtException,
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

describe('a process that dies of an uncaught exception', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /** The calls the crash path makes, in order, with the given flush. */
  function crash(flush: (ms: number) => Promise<unknown>) {
    const calls: string[] = [];
    const done = onUncaughtException(
      new Error('probe-marker-crash'),
      { error: (message: string) => void calls.push(`log ${message}`) },
      (_reason, context) => void calls.push(`report ${context.type}`),
      (ms) => {
        calls.push(`flush ${ms}`);
        return flush(ms);
      },
      (code) => void calls.push(`exit ${code}`),
    );
    return { calls, done };
  }

  it('is logged and reported, its report given time to leave, then it exits 1', async () => {
    let sent: () => void = () => undefined;
    const { calls, done } = crash(
      () =>
        new Promise<void>((resolve) => {
          sent = resolve;
        }),
    );
    await vi.advanceTimersByTimeAsync(FLUSH_BEFORE_EXIT_MS - 1);
    expect(calls).toEqual([
      'log Uncaught exception: probe-marker-crash',
      'report uncaughtException',
      `flush ${FLUSH_BEFORE_EXIT_MS}`,
    ]);
    sent();
    await done;
    expect(calls.at(-1)).toBe('exit 1');
  });

  it.each([
    ['rejects', () => Promise.reject(new Error('probe-marker-flush'))],
    ['hangs', () => new Promise<never>(() => undefined)],
  ])('still exits within the bound when the flush %s', async (_name, flush) => {
    const { calls, done } = crash(flush);
    await vi.advanceTimersByTimeAsync(FLUSH_BEFORE_EXIT_MS);
    await done;
    expect(calls.filter((call) => call === 'exit 1')).toHaveLength(1);
  });
});
