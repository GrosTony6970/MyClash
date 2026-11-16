import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SupabaseService } from '../supabase/supabase.service';
import { MatchAutoLockService } from './match-auto-lock.service';
import { MatchesService } from './matches.service';

/**
 * One auto-lock scan at a time (ruling 831). The first scan after a deploy can lock a backlog, one
 * write per bout, for longer than the 60 s tick: a second scan started
 * beside it would read and write the same groups. Fake timers and held promises, never wall-clock.
 */
describe('MatchAutoLockService: one scan at a time', () => {
  let release: () => void = () => undefined;
  const from = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
    from.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  /** A read that waits until `release()`, then answers with no rows. */
  function heldRead() {
    return {
      select: () =>
        new Promise((done) => {
          release = () => done({ data: [], error: null });
        }),
    };
  }

  async function started() {
    const module = await Test.createTestingModule({
      providers: [
        MatchAutoLockService,
        { provide: SupabaseService, useValue: { service: { from } } },
        { provide: MatchesService, useValue: {} },
      ],
    }).compile();
    await module.init();
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    module.get(MatchAutoLockService).start();
    return module;
  }

  it('a tick that finds a scan running does not start another', async () => {
    // The scan's first read is held; every later read answers at once with no rows.
    from.mockImplementation(() => ({ select: async () => ({ data: [], error: null }) }));
    from.mockImplementationOnce(heldRead);
    const module = await started();
    try {
      await vi.advanceTimersByTimeAsync(60_000);
      expect(from).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(120_000);
      expect(from).toHaveBeenCalledTimes(1);
      // The held read ends with no rows: the scan ends, and the next tick scans again.
      release();
      await vi.advanceTimersByTimeAsync(0);
      const done = from.mock.calls.length;
      await vi.advanceTimersByTimeAsync(60_000);
      expect(from.mock.calls.length).toBeGreaterThan(done);
    } finally {
      await module.close();
    }
  });

  it('a scan that fails on a read is logged once, and the next tick scans again', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    from.mockImplementation(() => {
      throw new Error('fetch failed');
    });
    const module = await started();
    try {
      await vi.advanceTimersByTimeAsync(60_000);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledWith('Auto-lock scan failed: fetch failed');
      await vi.advanceTimersByTimeAsync(60_000);
      expect(from).toHaveBeenCalledTimes(2);
      expect(warn).toHaveBeenCalledTimes(2);
    } finally {
      await module.close();
    }
  });
});
