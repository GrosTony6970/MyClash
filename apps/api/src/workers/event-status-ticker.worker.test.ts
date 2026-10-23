import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Logger } from '@nestjs/common';
import { EventStatusTickerWorker } from './event-status-ticker.worker';
import {
  filtersFor,
  mockSupabase,
  scopedTo,
  selectsFor,
  supabaseChain,
  writesTo,
  type TableSeed,
} from '../common/testing/supabase-chain';

/**
 * The hourly Event-status ticker, on its own clock (rulings 152, 154).
 *
 * An Event opens at 00:00 on its first day and closes at 06:00 after its last
 * day, both in the Event's zone. The `events` table is SEEDED, so the read's
 * filters decide which Events the ticker sees; the double never applies a
 * write, so what moved is read off the recorded writes and the counts.
 */
const NY = 'America/New_York';
const PARIS = 'Europe/Paris';

const event = (
  id: string,
  status: string,
  start_date: string,
  end_date: string,
  timezone = PARIS,
) => ({ id, status, start_date, end_date, timezone });

function build(events: TableSeed, options: { withLeagues?: boolean } = { withLeagues: true }) {
  const supabase = mockSupabase({ events });
  const leagues = { recomputeForEvent: vi.fn().mockResolvedValue(undefined) };
  const worker = new EventStatusTickerWorker(
    {} as never,
    supabase as never,
    options.withLeagues ? (leagues as never) : undefined,
  );
  const logger = (worker as unknown as { logger: Logger }).logger;
  const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
  vi.spyOn(logger, 'log').mockImplementation(() => undefined);
  return { worker, supabase, leagues, warn };
}

/** Each write to `events`: the Event it named and the status it set. */
const moves = (supabase: ReturnType<typeof mockSupabase>) =>
  writesTo(supabase, 'events').map((write) => ({
    id: scopedTo(write, 'id'),
    status: (write.row as { status: string }).status,
  }));

const recomputed = (leagues: { recomputeForEvent: ReturnType<typeof vi.fn> }) =>
  leagues.recomputeForEvent.mock.calls.map(([id]) => id);

const warned = (warn: { mock: { calls: unknown[][] } }): string[] =>
  warn.mock.calls.map(([message]) => String(message));

describe('EventStatusTickerWorker', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('leaves Events running at 19:05 New York time on their last day', async () => {
    vi.setSystemTime(new Date('2026-11-08T00:05:00Z'));
    const { worker, leagues } = build({
      rows: [
        event('ny', 'running', '2026-11-06', '2026-11-07', NY),
        event('paris', 'running', '2026-11-06', '2026-11-07'),
      ],
    });

    await expect(worker.tick()).resolves.toEqual({ toRunning: 0, toCompleted: 0 });
    expect(recomputed(leagues)).toEqual([]);
  });

  it('completes each Event at 06:00 after its last day, on its own clock', async () => {
    const rows = [
      event('ny', 'running', '2026-11-06', '2026-11-07', NY),
      event('paris', 'running', '2026-11-06', '2026-11-07'),
    ];
    // 06:00 Paris (CET) is 05:00Z; 06:00 New York (EST) is 11:00Z.
    vi.setSystemTime(new Date('2026-11-08T10:59:59Z'));
    const before = build({ rows });
    await expect(before.worker.tick()).resolves.toEqual({ toRunning: 0, toCompleted: 1 });
    expect(moves(before.supabase)).toEqual([{ id: 'paris', status: 'completed' }]);
    expect(recomputed(before.leagues)).toEqual(['paris']);

    vi.setSystemTime(new Date('2026-11-08T11:00:00Z'));
    const at = build({ rows });
    await expect(at.worker.tick()).resolves.toEqual({ toRunning: 0, toCompleted: 2 });
    expect(recomputed(at.leagues)).toEqual(['ny', 'paris']);
  });

  it('opens a New York Event at 00:00 New York time, with no League recompute', async () => {
    const rows = [event('ny', 'published', '2026-11-06', '2026-11-07', NY)];
    vi.setSystemTime(new Date('2026-11-06T00:05:00Z'));
    const evening = build({ rows });
    await expect(evening.worker.tick()).resolves.toEqual({ toRunning: 0, toCompleted: 0 });

    vi.setSystemTime(new Date('2026-11-06T05:00:00Z'));
    const midnight = build({ rows });
    await expect(midnight.worker.tick()).resolves.toEqual({ toRunning: 1, toCompleted: 0 });
    expect(moves(midnight.supabase)).toEqual([{ id: 'ny', status: 'running' }]);
    expect(recomputed(midnight.leagues)).toEqual([]);
  });

  it('opens a Kiritimati Event while the UTC date is still the day before', async () => {
    vi.setSystemTime(new Date('2026-07-09T10:00:00Z'));
    const { worker, supabase } = build({
      rows: [event('kiri', 'published', '2026-07-10', '2026-07-10', 'Pacific/Kiritimati')],
    });

    await expect(worker.tick()).resolves.toEqual({ toRunning: 1, toCompleted: 0 });
    expect(moves(supabase)).toEqual([{ id: 'kiri', status: 'running' }]);
  });

  it('never writes a running Event as running again', async () => {
    vi.setSystemTime(new Date('2026-11-07T12:00:00Z'));
    const { worker, supabase } = build({
      rows: [event('ny', 'running', '2026-11-06', '2026-11-07', NY)],
    });

    await expect(worker.tick()).resolves.toEqual({ toRunning: 0, toCompleted: 0 });
    expect(moves(supabase)).toEqual([]);
  });

  it('completes a published Event whose last day ended long ago, in one tick', async () => {
    vi.setSystemTime(new Date('2026-11-08T12:00:00Z'));
    const { worker, supabase, leagues } = build({
      rows: [event('old', 'published', '2026-01-10', '2026-01-11')],
    });

    await expect(worker.tick()).resolves.toEqual({ toRunning: 0, toCompleted: 1 });
    expect(moves(supabase)).toEqual([{ id: 'old', status: 'completed' }]);
    expect(recomputed(leagues)).toEqual(['old']);
  });

  it('reads only published and running Events that can open by tomorrow', async () => {
    vi.setSystemTime(new Date('2026-11-08T12:00:00Z'));
    const { worker, supabase, leagues, warn } = build({
      rows: [
        event('draft', 'draft', '2026-01-10', '2026-01-11'),
        event('done', 'completed', '2026-01-10', '2026-01-11'),
        event('gone', 'archived', '2026-01-10', '2026-01-11'),
        // An unknown zone warns once decided, so silence proves it was never read.
        event('far', 'published', '2099-06-01', '2099-06-02', 'Mars/Olympus'),
      ],
    });

    await expect(worker.tick()).resolves.toEqual({ toRunning: 0, toCompleted: 0 });
    expect(moves(supabase)).toEqual([]);
    expect(recomputed(leagues)).toEqual([]);
    expect(warned(warn).filter((message) => message.includes('far'))).toEqual([]);
    expect(selectsFor(supabase.from, 'events')[0]).toBe(
      'id, status, start_date, end_date, timezone',
    );
    expect(filtersFor(supabase.from, 'events', 'in')).toEqual([
      ['status', ['published', 'running']],
    ]);
    expect(filtersFor(supabase.from, 'events', 'lte')).toEqual([['start_date', '2026-11-09']]);
  });

  it('writes only if the status, dates and zone it decided on are unchanged', async () => {
    vi.setSystemTime(new Date('2026-11-08T12:00:00Z'));
    const { worker, supabase } = build({
      rows: [event('ny', 'running', '2026-11-06', '2026-11-07', NY)],
    });

    await worker.tick();

    expect(writesTo(supabase, 'events').map((write) => write.filters)).toEqual([
      [
        { method: 'eq', args: ['id', 'ny'] },
        { method: 'eq', args: ['status', 'running'] },
        { method: 'eq', args: ['start_date', '2026-11-06'] },
        { method: 'eq', args: ['end_date', '2026-11-07'] },
        { method: 'eq', args: ['timezone', NY] },
      ],
    ]);
  });

  it('counts and recomputes nothing when the write finds the Event already changed', async () => {
    vi.setSystemTime(new Date('2026-11-08T12:00:00Z'));
    const { worker, supabase, leagues, warn } = build({
      rows: [event('ny', 'running', '2026-11-06', '2026-11-07', NY)],
    });
    const seeded = supabase.from.getMockImplementation()!;
    supabase.from
      .mockImplementationOnce(seeded)
      .mockImplementationOnce(() => supabaseChain({ data: [], error: null }));

    await expect(worker.tick()).resolves.toEqual({ toRunning: 0, toCompleted: 0 });
    expect(recomputed(leagues)).toEqual([]);
    // A miss is never silent: were every write to miss, this line is the only trace.
    expect(warned(warn)).toEqual([expect.stringContaining('ny: changed since the read')]);
  });

  it('carries on to the next Event when a write fails', async () => {
    vi.setSystemTime(new Date('2026-11-08T12:00:00Z'));
    const { worker, supabase, leagues, warn } = build({
      rows: [
        event('ev-a', 'running', '2026-11-06', '2026-11-07'),
        event('ev-b', 'running', '2026-11-06', '2026-11-07'),
      ],
    });
    const seeded = supabase.from.getMockImplementation()!;
    supabase.from
      .mockImplementationOnce(seeded)
      .mockImplementationOnce(() => supabaseChain({ data: null, error: { message: 'boom' } }));

    await expect(worker.tick()).resolves.toEqual({ toRunning: 0, toCompleted: 1 });
    expect(recomputed(leagues)).toEqual(['ev-b']);
    expect(warned(warn).some((message) => message.includes('ev-a'))).toBe(true);
  });

  it('reads an unknown zone as Europe/Paris and says so', async () => {
    // 06:00 Paris (CEST) after a last day on 12 July.
    vi.setSystemTime(new Date('2026-07-13T04:00:00Z'));
    const { worker, supabase, warn } = build({
      rows: [
        event('mars', 'running', '2026-07-11', '2026-07-12', 'Mars/Olympus'),
        event('paris', 'running', '2026-07-11', '2026-07-12'),
      ],
    });

    await expect(worker.tick()).resolves.toEqual({ toRunning: 0, toCompleted: 2 });
    expect(moves(supabase)).toEqual([
      { id: 'mars', status: 'completed' },
      { id: 'paris', status: 'completed' },
    ]);
    expect(warned(warn)).toEqual([expect.stringContaining('"Mars/Olympus"')]);
    expect(warned(warn)[0]).toContain('mars');
  });

  it('skips an Event whose last day cannot be read, and says so', async () => {
    vi.setSystemTime(new Date('2026-07-13T05:00:00Z'));
    const { worker, supabase, warn } = build({
      rows: [
        event('bad', 'running', '2026-07-11', '2026-13-40'),
        event('good', 'running', '2026-07-11', '2026-07-12'),
      ],
    });

    await expect(worker.tick()).resolves.toEqual({ toRunning: 0, toCompleted: 1 });
    expect(moves(supabase)).toEqual([{ id: 'good', status: 'completed' }]);
    expect(warned(warn)).toEqual([expect.stringContaining('bad')]);
  });

  it('answers zero and warns when the read fails', async () => {
    const { worker, warn } = build({ data: null, error: { message: 'down' } } as TableSeed);

    await expect(worker.tick()).resolves.toEqual({ toRunning: 0, toCompleted: 0 });
    expect(warned(warn)).toEqual([expect.stringContaining('down')]);
  });

  it('continues the batch when one league recompute throws', async () => {
    vi.setSystemTime(new Date('2026-11-08T12:00:00Z'));
    const { worker, leagues } = build({
      rows: [
        event('ev-9', 'running', '2026-11-06', '2026-11-07'),
        event('ev-10', 'running', '2026-11-06', '2026-11-07'),
      ],
    });
    leagues.recomputeForEvent
      .mockImplementationOnce(() => {
        throw new Error('league x exploded');
      })
      .mockResolvedValueOnce(undefined);

    await expect(worker.tick()).resolves.toMatchObject({ toCompleted: 2 });
    expect(recomputed(leagues)).toEqual(['ev-9', 'ev-10']);
  });

  it('runs cleanly when no LeaguesService is wired (the recompute is best-effort)', async () => {
    vi.setSystemTime(new Date('2026-11-08T12:00:00Z'));
    const { worker } = build(
      { rows: [event('ev-11', 'running', '2026-11-06', '2026-11-07')] },
      { withLeagues: false },
    );

    await expect(worker.tick()).resolves.toEqual({ toRunning: 0, toCompleted: 1 });
  });
});
