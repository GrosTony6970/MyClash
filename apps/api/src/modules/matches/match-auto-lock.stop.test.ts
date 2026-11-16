import { readFileSync } from 'node:fs';
import path from 'node:path';
import { Global, Logger, Module, type OnModuleDestroy } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { supabaseFrom } from '../../common/testing/supabase-chain';
import { SupabaseService } from '../supabase/supabase.service';
import { AUTO_LOCK_STOP_WAIT_MS, MatchAutoLockService } from './match-auto-lock.service';
import { MatchesService } from './matches.service';

/** A read that answers only when `answer` settles: every filter returns the read itself. */
function heldRead(answer: Promise<unknown>) {
  const read: Record<string, unknown> = {
    then: (ok: (value: unknown) => unknown, ko: (err: unknown) => unknown) => answer.then(ok, ko),
  };
  for (const method of ['select', 'eq', 'in', 'is', 'gt', 'order', 'limit']) {
    read[method] = () => read;
  }
  return read;
}

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
  const releasedRead = () =>
    heldRead(new Promise((done) => (release = () => done({ data: [], error: null }))));

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

  it('a tick that finds a scan running does not start another, and says so', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    // The scan's first read is held; every later read answers at once with no Events.
    const none = supabaseFrom({ events: { rows: [] } });
    from.mockImplementation(none);
    from.mockImplementationOnce(releasedRead);
    const module = await started();
    try {
      await vi.advanceTimersByTimeAsync(60_000);
      expect(from).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(120_000);
      expect(from).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls.map(([line]) => line)).toEqual([
        'Auto-lock scan still running after 60 s: this tick is skipped',
        'Auto-lock scan still running after 120 s: this tick is skipped',
      ]);
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

/**
 * A stop waits for the scan, bounded (ruling 831). One single-elimination phase is ONE group, so a
 * finished Bracket of 8 bouts is 8 locks in one scan: the stop must wait for the lock in progress,
 * not the whole phase, and never more than 30 s.
 */
describe('MatchAutoLockService: a stop waits for the scan, bounded', () => {
  const OLD = '2026-01-01T10:00:00.000Z';
  const tables = supabaseFrom({
    events: { rows: [{ id: 'e1', status: 'running' }] },
    tournaments: { rows: [{ id: 't1', event_id: 'e1', lock_config_json: {} }] },
    phases: { rows: [{ id: 'p1', tournament_id: 't1', type: 'single_elim' }] },
    matches: {
      rows: Array.from({ length: 8 }, (_, i) => ({
        id: `m${i}`,
        phase_id: 'p1',
        pool_id: null,
        status: 'completed',
        ended_at: OLD,
        updated_at: OLD,
        locked_at: null,
      })),
    },
  });
  let releaseLock: () => void = () => undefined;
  let releaseRead: () => void = () => undefined;
  const lockMatch = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
    lockMatch.mockReset();
    // The first lock is held until releaseLock(); every later one answers at once.
    lockMatch.mockImplementation(async () => ({ id: 'locked' }));
    lockMatch.mockImplementationOnce(
      () => new Promise((done) => (releaseLock = () => done({ id: 'locked' }))),
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  /** Started, its first lock held. With `failingRead`, the bouts' read is held instead. */
  async function scanning(extra: unknown[] = [], failingRead = false) {
    const from = (table: string) =>
      failingRead && table === 'matches'
        ? heldRead(
            new Promise((_done, fail) => (releaseRead = () => fail(new Error('fetch failed')))),
          )
        : tables(table);
    const module = await Test.createTestingModule({
      imports: extra as never[],
      providers: [
        MatchAutoLockService,
        { provide: SupabaseService, useValue: { service: { from } } },
        { provide: MatchesService, useValue: { lockMatch } },
      ],
    }).compile();
    await module.init();
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    module.get(MatchAutoLockService).start();
    await vi.advanceTimersByTimeAsync(60_000); // the scan starts; its first lock or read is held
    expect(lockMatch).toHaveBeenCalledTimes(failingRead ? 0 : 1);
    return module;
  }

  it('a stop during a Bracket lets the lock in progress end, and makes no other', async () => {
    const module = await scanning();
    const closed = module.close();
    await vi.advanceTimersByTimeAsync(0); // the stop has begun: onModuleDestroy ran
    releaseLock();
    await closed;
    expect(lockMatch).toHaveBeenCalledTimes(1);
  });

  it('a lock that never answers holds the stop 30 s at most, and says so', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const module = await scanning();
    let done = false;
    const closed = module.close().then(() => (done = true));
    await vi.advanceTimersByTimeAsync(AUTO_LOCK_STOP_WAIT_MS - 1);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await closed;
    expect(done).toBe(true);
    expect(warn).toHaveBeenCalledWith(
      'Auto-lock lock still running 30 s after the stop: the stop goes on',
    );
  });

  it('the queue Workers close while the scan winds down, not after it', async () => {
    // Stands for @nestjs/bullmq's BullModule: global, so destroyed last, and its
    // onModuleDestroy closes every Worker (bull.explorer.js).
    const order: string[] = [];
    @Global()
    @Module({})
    class WorkersStandIn implements OnModuleDestroy {
      onModuleDestroy(): void {
        order.push('workers closed');
      }
    }
    const module = await scanning([WorkersStandIn]);
    const closed = module.close();
    await vi.advanceTimersByTimeAsync(0);
    expect(order).toEqual(['workers closed']);
    order.push('lock ends');
    releaseLock();
    await closed;
    expect(order).toEqual(['workers closed', 'lock ends']);
  });

  it('a scan whose read fails while the module closes is warned once, and the stop ends', async () => {
    // A read, not a lock: a failed lock is logged and the scan goes on (ruling 831), so only a
    // failed read ends the scan with an error. Nest absorbs a rejecting hook, so the warning, not
    // close() resolving, is what proves the failure was caught.
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const module = await scanning([], true);
    const closed = module.close();
    await vi.advanceTimersByTimeAsync(0);
    releaseRead();
    await closed;
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith('Auto-lock scan failed: fetch failed');
  });

  it('@nestjs/bullmq still closes its Workers in onModuleDestroy (the order above relies on it)', () => {
    // BullExplorer is not in the package's exports: read the installed file (12.0.0 closed the
    // Workers in onApplicationShutdown, after this wait, which would add the two waits up).
    const pkg = require.resolve('@nestjs/bullmq/package.json');
    const explorer = readFileSync(path.join(path.dirname(pkg), 'dist/bull.explorer.js'), 'utf8');
    expect(explorer).toMatch(
      /onModuleDestroy\(\) \{\s*return Promise\.all\(this\.workers\.map\(\(worker\) => worker\.close\(\)\)\);/,
    );
  });
});
