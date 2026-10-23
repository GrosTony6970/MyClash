/**
 * event-archive.worker.test.ts
 *
 * Tests for EventArchiveWorker.runAutoArchive():
 *   ✓ eligible event (end_date 25h ago, all tournaments completed 25h ago) is archived
 *   ✓ event with end_date only 12h ago is skipped (within 24h grace window)
 *   ✓ event with a non-completed tournament is skipped
 *   ✓ audit_log row is written for archived events
 *   ✓ only a completed Event is archived (ruling 156), on the seeded double
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Logger } from '@nestjs/common';
import { EventArchiveWorker } from './event-archive.worker';
import { mockSupabase, scopedTo, supabaseChain, writesTo } from '../common/testing/supabase-chain';

// ── Mock helpers ──────────────────────────────────────────────────────────────

const fromMock = vi.fn();
const cannedSupabase = { service: { from: fromMock } };

function makeQueue() {
  return { add: vi.fn().mockResolvedValue(undefined) } as never;
}

/**
 * A Supabase-style fluent chain that resolves to `result` when awaited
 * AND supports chaining select/eq/in/lt/update/insert methods.
 */
function makeChain(result: unknown) {
  type AnyFn = ReturnType<typeof vi.fn>;
  const chain: Record<string, AnyFn | unknown> = {};
  const methods = ['select', 'eq', 'in', 'lt', 'lte', 'update', 'insert', 'neq'];
  for (const m of methods) {
    chain[m] = vi.fn().mockReturnValue(chain);
  }
  // Allow awaiting the chain itself
  const awaitable = Object.assign(Promise.resolve(result), chain);
  for (const m of methods) {
    (awaitable as unknown as Record<string, AnyFn>)[m] = vi.fn().mockReturnValue(awaitable);
  }
  return awaitable as typeof awaitable & Record<string, AnyFn>;
}

function makeWorker() {
  return new EventArchiveWorker(makeQueue(), cannedSupabase as never);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('EventArchiveWorker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('archives an eligible event (end_date 25h ago, all tournaments completed 25h ago)', async () => {
    const now = new Date();
    const twentyFiveHoursAgo = new Date(now.getTime() - 25 * 60 * 60 * 1000).toISOString();

    // 1. Candidates query: returns one event
    const candidatesChain = makeChain({
      data: [{ id: 'event-1', status: 'completed', end_date: twentyFiveHoursAgo }],
      error: null,
    });

    // 2. Tournaments query for event-1: all completed 25h ago
    const tournamentsChain = makeChain({
      data: [
        { id: 'tourn-1', status: 'completed', updated_at: twentyFiveHoursAgo },
        { id: 'tourn-2', status: 'completed', updated_at: twentyFiveHoursAgo },
      ],
      error: null,
    });

    // 3. Update event status to 'archived': the row it hit comes back
    const updateChain = makeChain({ data: [{ id: 'event-1' }], error: null });

    // 4. Audit log insert
    const auditChain = makeChain({ error: null });

    fromMock
      .mockReturnValueOnce(candidatesChain)
      .mockReturnValueOnce(tournamentsChain)
      .mockReturnValueOnce(updateChain)
      .mockReturnValueOnce(auditChain);

    const worker = makeWorker();
    const result = await worker.runAutoArchive();

    expect(result.archived).toEqual(['event-1']);
  });

  it('asks for the Events that ended on or before the day 24 h ago, as a day (end_date is a DATE)', async () => {
    vi.useFakeTimers({ now: new Date('2026-10-17T01:30:00.000Z') });
    try {
      const candidatesChain = makeChain({ data: [], error: null });
      fromMock.mockReturnValueOnce(candidatesChain);

      await makeWorker().runAutoArchive();

      // The old text filter `end_date < '2026-10-16T01:30:00.000Z'` took an Event ending on the
      // 16th; a timestamp cast to a DATE would not.
      expect(candidatesChain.lte).toHaveBeenCalledWith('end_date', '2026-10-16');
      expect(candidatesChain.lt).not.toHaveBeenCalled();
      // Ruling 156: a completed Event only, never a running one.
      expect(candidatesChain.eq).toHaveBeenCalledWith('status', 'completed');
      expect(candidatesChain.in).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('skips an event whose end_date is only 12h ago (within 24h grace window)', async () => {
    const now = new Date();
    const twelveHoursAgo = new Date(now.getTime() - 12 * 60 * 60 * 1000).toISOString();
    const twentyFiveHoursAgo = new Date(now.getTime() - 25 * 60 * 60 * 1000).toISOString();

    // Candidates: event with end_date only 12h ago (it passed the .lt filter in a test
    // scenario where we control the returned data directly)
    const candidatesChain = makeChain({
      data: [{ id: 'event-2', status: 'completed', end_date: twelveHoursAgo }],
      error: null,
    });

    // Tournaments: completed 25h ago — but lastMilestone = max(12h, 25h) = 25h ago
    // However since end_date is only 12h ago, lastMilestone = max(12h, 25h) = 25h ago.
    // Wait: max(12h ago, 25h ago) = 12h ago (more recent). So it should be SKIPPED.
    const tournamentsChain = makeChain({
      data: [{ id: 'tourn-3', status: 'completed', updated_at: twentyFiveHoursAgo }],
      error: null,
    });

    fromMock.mockReturnValueOnce(candidatesChain).mockReturnValueOnce(tournamentsChain);

    const worker = makeWorker();
    const result = await worker.runAutoArchive();

    expect(result.archived).toEqual([]);
  });

  it('skips an event that has a non-completed tournament', async () => {
    const now = new Date();
    const twentyFiveHoursAgo = new Date(now.getTime() - 25 * 60 * 60 * 1000).toISOString();

    const candidatesChain = makeChain({
      data: [{ id: 'event-3', status: 'completed', end_date: twentyFiveHoursAgo }],
      error: null,
    });

    // One tournament still running — not all completed
    const tournamentsChain = makeChain({
      data: [
        { id: 'tourn-4', status: 'completed', updated_at: twentyFiveHoursAgo },
        { id: 'tourn-5', status: 'running', updated_at: twentyFiveHoursAgo },
      ],
      error: null,
    });

    fromMock.mockReturnValueOnce(candidatesChain).mockReturnValueOnce(tournamentsChain);

    const worker = makeWorker();
    const result = await worker.runAutoArchive();

    expect(result.archived).toEqual([]);
  });

  it('skips an event with no tournaments', async () => {
    const now = new Date();
    const twentyFiveHoursAgo = new Date(now.getTime() - 25 * 60 * 60 * 1000).toISOString();

    const candidatesChain = makeChain({
      data: [{ id: 'event-4', status: 'completed', end_date: twentyFiveHoursAgo }],
      error: null,
    });

    const tournamentsChain = makeChain({ data: [], error: null });

    fromMock.mockReturnValueOnce(candidatesChain).mockReturnValueOnce(tournamentsChain);

    const worker = makeWorker();
    const result = await worker.runAutoArchive();

    expect(result.archived).toEqual([]);
  });

  it('returns empty when the candidates query errors', async () => {
    const candidatesChain = makeChain({
      data: null,
      error: { message: 'DB connection failed' },
    });

    fromMock.mockReturnValueOnce(candidatesChain);

    const worker = makeWorker();
    const result = await worker.runAutoArchive();

    expect(result.archived).toEqual([]);
  });
});

/**
 * Ruling 156: only a completed Event is archived. The ticker is the one way into
 * `completed`, and it runs the League update; an Event archived while still
 * running would skip it. Seeded, so the read's filter decides who is archived.
 */
describe('EventArchiveWorker: a completed Event only', () => {
  const finished = '2026-10-17T18:00:00.000Z';

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-10-20T12:00:00.000Z') });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function seeded(events: Array<{ id: string; status: string }>) {
    return mockSupabase({
      events: { rows: events.map((e) => ({ ...e, end_date: '2026-10-17' })) },
      tournaments: {
        rows: events.map((e) => ({
          id: `t-${e.id}`,
          event_id: e.id,
          status: 'completed',
          updated_at: finished,
        })),
      },
      audit_log: { rows: [] },
    });
  }

  it('archives the completed Event and leaves the running one', async () => {
    const supabase = seeded([
      { id: 'run', status: 'running' },
      { id: 'done', status: 'completed' },
    ]);

    const result = await new EventArchiveWorker(makeQueue(), supabase as never).runAutoArchive();

    expect(result.archived).toEqual(['done']);
    const archived = writesTo(supabase, 'events');
    expect(archived.map((write) => scopedTo(write, 'id'))).toEqual(['done']);
    expect(scopedTo(archived[0], 'status')).toBe('completed');
    expect(writesTo(supabase, 'audit_log').map((write) => write.row)).toEqual([
      expect.objectContaining({ action: 'event.auto_archive', entity_id: 'done' }),
    ]);
  });

  it('does not archive an Event reopened between the read and the write', async () => {
    const supabase = seeded([{ id: 'done', status: 'completed' }]);
    const seededFrom = supabase.from.getMockImplementation()!;
    // The candidates read and the Tournaments read see the seed; the write finds no row.
    supabase.from
      .mockImplementationOnce(seededFrom)
      .mockImplementationOnce(seededFrom)
      .mockImplementationOnce(() => supabaseChain({ data: [], error: null }));

    const worker = new EventArchiveWorker(makeQueue(), supabase as never);
    const log = vi.spyOn((worker as unknown as { logger: Logger }).logger, 'log');
    log.mockImplementation(() => undefined);
    const result = await worker.runAutoArchive();

    expect(result.archived).toEqual([]);
    expect(writesTo(supabase, 'audit_log')).toEqual([]);
    expect(log.mock.calls.map(([message]) => String(message))).toContain(
      'Event done: no longer completed; not archived',
    );
  });
});
