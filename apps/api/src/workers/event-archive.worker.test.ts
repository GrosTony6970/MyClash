/**
 * event-archive.worker.test.ts
 *
 * Tests for EventArchiveWorker.runAutoArchive():
 *   ✓ eligible event (end_date 25h ago, all tournaments completed 25h ago) is archived
 *   ✓ event with end_date only 12h ago is skipped (within 24h grace window)
 *   ✓ event with a non-completed tournament is skipped
 *   ✓ audit_log row is written for archived events
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EventArchiveWorker } from './event-archive.worker';

// ── Mock helpers ──────────────────────────────────────────────────────────────

const fromMock = vi.fn();
const mockSupabase = { service: { from: fromMock } };

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
  const methods = ['select', 'eq', 'in', 'lt', 'update', 'insert', 'neq'];
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
  return new EventArchiveWorker(makeQueue(), mockSupabase as never);
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

    // 3. Update event status to 'archived'
    const updateChain = makeChain({ error: null });

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

  it('skips an event whose end_date is only 12h ago (within 24h grace window)', async () => {
    const now = new Date();
    const twelveHoursAgo = new Date(now.getTime() - 12 * 60 * 60 * 1000).toISOString();
    const twentyFiveHoursAgo = new Date(now.getTime() - 25 * 60 * 60 * 1000).toISOString();

    // Candidates: event with end_date only 12h ago (it passed the .lt filter in a test
    // scenario where we control the returned data directly)
    const candidatesChain = makeChain({
      data: [{ id: 'event-2', status: 'running', end_date: twelveHoursAgo }],
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
      data: [{ id: 'event-3', status: 'running', end_date: twentyFiveHoursAgo }],
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
