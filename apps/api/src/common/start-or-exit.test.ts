import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FLUSH_BEFORE_EXIT_MS } from './process-failure-handlers';
import { START_TIMEOUT_MS, startOrExit } from './start-or-exit';

/** Every call the start path makes, in order. */
function recorder(flush: (ms: number) => Promise<unknown> = async () => undefined) {
  const calls: string[] = [];
  return {
    calls,
    options: {
      logger: { error: (message: string) => void calls.push(`log ${message}`) },
      report: (_reason: unknown, context: { type: string; message: string }) =>
        void calls.push(`report ${context.type} ${context.message}`),
      flush: (ms: number) => {
        calls.push(`flush ${ms}`);
        return flush(ms);
      },
      exit: (code: number) => void calls.push(`exit ${code}`),
    },
  };
}

describe('startOrExit', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('a start that fails is logged, reported, flushed, then exits 1, in that order', async () => {
    const { calls, options } = recorder();
    await startOrExit(() => Promise.reject(new Error('probe-marker-hook')), options);
    expect(calls).toEqual([
      'log The API did not start: probe-marker-hook',
      'report start probe-marker-hook',
      `flush ${FLUSH_BEFORE_EXIT_MS}`,
      'exit 1',
    ]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('a start that hangs counts as failed once the bound passes', async () => {
    const { calls, options } = recorder();
    void startOrExit(() => new Promise<void>(() => undefined), options);
    await vi.advanceTimersByTimeAsync(START_TIMEOUT_MS - 1);
    expect(calls).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(calls).toEqual([
      'log The API did not start: The start did not finish within 60 s',
      'report start The start did not finish within 60 s',
      `flush ${FLUSH_BEFORE_EXIT_MS}`,
      'exit 1',
    ]);
  });

  it('a start that finishes leaves no timer and never exits', async () => {
    const { calls, options } = recorder();
    await startOrExit(async () => undefined, options);
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(START_TIMEOUT_MS * 2);
    expect(calls).toEqual([]);
  });

  it('a start that fails after the bound passed is not reported twice', async () => {
    const { calls, options } = recorder();
    let failLate: (reason: Error) => void = () => undefined;
    const done = startOrExit(
      () =>
        new Promise<void>((_resolve, reject) => {
          failLate = reject;
        }),
      options,
    );
    await vi.advanceTimersByTimeAsync(START_TIMEOUT_MS);
    failLate(new Error('probe-marker-late'));
    await done;
    expect(calls.filter((call) => call.startsWith('exit'))).toEqual(['exit 1']);
    expect(calls.join('\n')).not.toContain('probe-marker-late');
  });

  it.each([
    ['rejects', () => Promise.reject(new Error('probe-marker-flush'))],
    ['hangs', () => new Promise<never>(() => undefined)],
  ])('a flush that %s still ends the process within its bound', async (_name, flush) => {
    const { calls, options } = recorder(flush);
    const done = startOrExit(() => Promise.reject(new Error('probe-marker-hook')), options);
    await vi.advanceTimersByTimeAsync(FLUSH_BEFORE_EXIT_MS);
    await done;
    expect(calls.at(-1)).toBe('exit 1');
  });
});

describe('startOrExit, when describing or reporting the failure fails', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('a rejection JSON cannot write is described and still exits 1', async () => {
    const { calls, options } = recorder();
    const circular: Record<string, unknown> = {};
    circular['self'] = circular;
    await startOrExit(() => Promise.reject(circular), options);
    expect(calls).toEqual([
      'log The API did not start: [object Object]',
      'report start [object Object]',
      `flush ${FLUSH_BEFORE_EXIT_MS}`,
      'exit 1',
    ]);
  });

  // `resolves`: a startOrExit that rejects would hand its rejection to the unhandledRejection
  // handler, which only logs. The exit must come, and nothing must escape after it either.
  it('a reporter that throws does not keep the failed start alive', async () => {
    const { calls, options } = recorder();
    const report = () => {
      throw new Error('probe-marker-reporter');
    };
    const start = () => Promise.reject(new Error('probe-marker-hook'));
    await expect(startOrExit(start, { ...options, report })).resolves.toBeUndefined();
    expect(calls.at(-1)).toBe('exit 1');
  });

  it('a logger that throws skips neither the report nor the exit', async () => {
    const { calls, options } = recorder();
    const logger = {
      error: () => {
        throw new Error('probe-marker-logger');
      },
    };
    const start = () => Promise.reject(new Error('probe-marker-hook'));
    await expect(startOrExit(start, { ...options, logger })).resolves.toBeUndefined();
    expect(calls).toEqual([
      'report start probe-marker-hook',
      `flush ${FLUSH_BEFORE_EXIT_MS}`,
      'exit 1',
    ]);
  });
});

// main.ts runs at import, so it is read, not run. The CI start check runs it for real.
describe('main.ts', () => {
  const main = readFileSync(join(__dirname, '..', 'main.ts'), 'utf8');

  it('starts through startOrExit, a wiring error rejecting instead of ending the process', () => {
    expect(main).toContain('void startOrExit(bootstrap, {');
    expect(main).toContain('{ abortOnError: false },');
    expect(main).not.toContain('void bootstrap()');
  });

  it('gives the crash path the Sentry flush, and names Swagger only when it is served', () => {
    expect(main).toMatch(/registerProcessFailureHandlers\([^;]*flushApiSentry,\s*\);/);
    expect(main).toContain('if (swagger) console.info(`Swagger UI:');
  });
});
