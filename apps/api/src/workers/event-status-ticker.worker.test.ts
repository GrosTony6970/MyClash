import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EventStatusTickerWorker } from './event-status-ticker.worker';

/**
 * Tests the `tick()` orchestration: which Supabase calls fire, with which
 * filters, and which side-effects fire on transition. The worker calls
 * `.from('events').update(...).eq(...).{lt|lte}(...).select('id')` for each
 * direction — our mocks model that fluent chain.
 */

function makeUpdateChain(returnedIds: string[]) {
  // Chains: from('events').update(...).eq(...).lte(...) | .lt(...) .select('id')
  // The terminal `.select('id')` resolves with the row payload.
  const chain: Record<string, unknown> = {};
  chain['update'] = vi.fn().mockReturnValue(chain);
  chain['eq'] = vi.fn().mockReturnValue(chain);
  chain['lte'] = vi.fn().mockReturnValue(chain);
  chain['lt'] = vi.fn().mockReturnValue(chain);
  chain['select'] = vi
    .fn()
    .mockResolvedValue({ data: returnedIds.map((id) => ({ id })), error: null });
  return chain;
}

function makeQueue() {
  return { add: vi.fn().mockResolvedValue(undefined) } as never;
}

describe('EventStatusTickerWorker', () => {
  let supabaseFrom: ReturnType<typeof vi.fn>;
  let leagues: { recomputeForEvent: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    supabaseFrom = vi.fn();
    leagues = { recomputeForEvent: vi.fn().mockResolvedValue(undefined) };
  });

  function makeWorker(
    publishedToRunning: string[],
    runningToCompleted: string[],
    options: { withLeagues?: boolean } = { withLeagues: true },
  ) {
    const chain1 = makeUpdateChain(publishedToRunning);
    const chain2 = makeUpdateChain(runningToCompleted);
    supabaseFrom.mockReturnValueOnce(chain1).mockReturnValueOnce(chain2);
    const worker = new EventStatusTickerWorker(
      makeQueue(),
      { service: { from: supabaseFrom } } as never,
      options.withLeagues ? (leagues as never) : undefined,
    );
    return { worker, chain1, chain2 };
  }

  it('flips published events whose start_date is today or earlier to running', async () => {
    const { worker, chain1 } = makeWorker(['ev-1', 'ev-2'], []);

    const result = await worker.tick();

    expect(result.toRunning).toBe(2);
    expect(chain1['update']).toHaveBeenCalledWith(expect.objectContaining({ status: 'running' }));
    // The eq() filter should be the source state, lte() the start_date cutoff.
    expect(chain1['eq']).toHaveBeenCalledWith('status', 'published');
    expect(chain1['lte']).toHaveBeenCalledWith('start_date', expect.any(String));
  });

  it('flips running events whose end_date is in the past to completed (strict <)', async () => {
    const { worker, chain2 } = makeWorker([], ['ev-3']);

    const result = await worker.tick();

    expect(result.toCompleted).toBe(1);
    expect(chain2['update']).toHaveBeenCalledWith(expect.objectContaining({ status: 'completed' }));
    expect(chain2['eq']).toHaveBeenCalledWith('status', 'running');
    // end_date < today (today's running event must NOT be auto-completed).
    expect(chain2['lt']).toHaveBeenCalledWith('end_date', expect.any(String));
  });

  it('never touches draft or archived events', async () => {
    const { worker, chain1, chain2 } = makeWorker([], []);

    await worker.tick();

    // The .eq filter on both chains is the gate. Neither targets `draft`
    // nor `archived` — only `published` and `running`.
    const allEqCalls = [...chain1['eq'].mock.calls, ...chain2['eq'].mock.calls];
    const eqStatusValues = allEqCalls.filter(([col]) => col === 'status').map(([, value]) => value);
    expect(eqStatusValues).toEqual(['published', 'running']);
    expect(eqStatusValues).not.toContain('draft');
    expect(eqStatusValues).not.toContain('archived');
    expect(eqStatusValues).not.toContain('completed');
  });

  it('calls leagues.recomputeForEvent() once per event that transitioned to completed', async () => {
    const { worker } = makeWorker([], ['ev-7', 'ev-8']);

    const result = await worker.tick();

    expect(result.toCompleted).toBe(2);
    expect(leagues.recomputeForEvent).toHaveBeenCalledTimes(2);
    expect(leagues.recomputeForEvent).toHaveBeenCalledWith('ev-7');
    expect(leagues.recomputeForEvent).toHaveBeenCalledWith('ev-8');
  });

  it('continues the batch when one league recompute throws', async () => {
    const { worker } = makeWorker([], ['ev-9', 'ev-10']);
    leagues.recomputeForEvent
      .mockImplementationOnce(() => {
        throw new Error('league x exploded');
      })
      .mockResolvedValueOnce(undefined);

    // Should NOT throw — the failure is logged and the batch finishes.
    await expect(worker.tick()).resolves.toMatchObject({ toCompleted: 2 });
    expect(leagues.recomputeForEvent).toHaveBeenCalledTimes(2);
  });

  it('runs cleanly when no LeaguesService is wired (the recompute is best-effort)', async () => {
    const { worker } = makeWorker([], ['ev-11'], { withLeagues: false });

    await expect(worker.tick()).resolves.toMatchObject({
      toRunning: 0,
      toCompleted: 1,
    });
  });
});
