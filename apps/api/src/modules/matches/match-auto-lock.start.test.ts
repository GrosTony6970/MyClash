import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { supabaseFrom } from '../../common/testing/supabase-chain';
import { SupabaseService } from '../supabase/supabase.service';
import { MatchAutoLockService } from './match-auto-lock.service';
import { MatchesService } from './matches.service';

/**
 * The scan runs where `start()` is called, and nowhere else (ruling 809): the worker calls it
 * (workers/worker-role.ts); the api builds this service and must not scan. Built through Nest's
 * lifecycle, so a start-up hook that brought the timer back would run here.
 */
describe('MatchAutoLockService start', () => {
  let from = supabaseFrom({});

  beforeEach(() => {
    vi.useFakeTimers();
    from = supabaseFrom({ events: { rows: [] } });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  async function built() {
    const module = await Test.createTestingModule({
      providers: [
        MatchAutoLockService,
        { provide: SupabaseService, useValue: { service: { from } } },
        { provide: MatchesService, useValue: {} },
      ],
    }).compile();
    await module.init();
    return module;
  }

  it('does not scan when nobody starts it, however long the process runs', async () => {
    const module = await built();
    try {
      await vi.advanceTimersByTimeAsync(180_000);
      expect(from).not.toHaveBeenCalled();
    } finally {
      await module.close();
    }
  });

  it('scans every 60 s once started, and says so once', async () => {
    const log = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    const module = await built();
    try {
      module.get(MatchAutoLockService).start();
      // Nest's own start lines go through Logger too: count this one.
      const said = () => log.mock.calls.filter(([line]) => line === 'Auto-lock scan every 60 s');
      expect(said()).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(from).toHaveBeenCalledWith('events');
      const afterOne = from.mock.calls.length;
      await vi.advanceTimersByTimeAsync(60_000);
      expect(from.mock.calls.length).toBe(afterOne * 2);
      expect(said()).toHaveLength(1);
    } finally {
      await module.close();
    }
  });

  it('stops scanning when the module closes', async () => {
    const module = await built();
    module.get(MatchAutoLockService).start();
    await module.close();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(from).not.toHaveBeenCalled();
  });
});
