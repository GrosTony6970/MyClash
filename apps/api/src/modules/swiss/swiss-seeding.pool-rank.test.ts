import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { mockSupabase, queriedTables } from '../../common/testing/supabase-chain';
import type { SupabaseService } from '../supabase/supabase.service';
import { SwissSeedingService } from './swiss-seeding.service';

/** Round-1 order read from a finished pool phase (`by-pool-rank`), and its refusals. */

const as = (supabase: { service: unknown }): SupabaseService =>
  supabase as unknown as SupabaseService;

/** What a refusal sends: its `code`, its English `message`, and any numbers it carries. */
const refusalOf = (work: Promise<unknown>) =>
  work.catch((error: BadRequestException) => error.getResponse());

describe('rankFromCompletedPools', () => {
  /**
   * A finished pool phase of t1, alongside the rows a wider read would take:
   * this tournament's BRACKET phase, another tournament's pool phase, and an
   * open bout belonging to neither.
   */
  const completedPool = {
    phases: {
      rows: [
        { id: 'bracket-1', tournament_id: 't1', type: 'single_elim', status: 'pending' },
        { id: 'pool-1', tournament_id: 't1', type: 'pool', status: 'completed' },
        { id: 'pool-9', tournament_id: 't9', type: 'pool', status: 'completed' },
      ],
    },
    matches: {
      rows: [
        { id: 'm1', phase_id: 'pool-1', status: 'completed' },
        // Still being fought, and in another phase. Counted here it would
        // refuse a draw the pool phase is actually ready for.
        { id: 'm-open', phase_id: 'bracket-1', status: 'in_progress' },
      ],
    },
  };

  /** A pool member, carrying the dotted key the embedded filter reads. */
  const member = (
    registrationId: string,
    seed: number | null,
    sortOrder: number,
    phaseId = 'pool-1',
  ) => ({
    registration_id: registrationId,
    seed,
    'pools.phase_id': phaseId,
    pools: { sort_order: sortOrder, phase_id: phaseId },
  });

  it('refuses when the tournament has no pool phase', async () => {
    // A pool phase exists, but it belongs to another tournament.
    const supabase = mockSupabase({
      phases: { rows: [{ id: 'pool-9', tournament_id: 't9', type: 'pool', status: 'completed' }] },
    });
    const work = new SwissSeedingService(as(supabase)).rankFromCompletedPools('t1', null);
    expect(await refusalOf(work)).toMatchObject({
      code: 'pool_phase_missing',
      message: expect.stringMatching(/needs a pool phase/),
    });
  });

  it("refuses another tournament's source phase with the answer an unknown one gets", async () => {
    // pool-9 is complete: read, it would seed t1's Swiss with another
    // tournament's fighters. The same 400 tells the caller no id exists elsewhere.
    const supabase = mockSupabase({
      phases: completedPool.phases,
      matches: { rows: [{ id: 'm9', phase_id: 'pool-9', status: 'completed' }] },
      pool_members: { rows: [member('reg-9', 1, 1, 'pool-9')] },
    });
    const answers: unknown[] = [];
    for (const named of ['pool-9', 'no-such-phase']) {
      const refusal = await new SwissSeedingService(as(supabase))
        .rankFromCompletedPools('t1', named)
        .catch((error: unknown) => error);
      expect(refusal).toBeInstanceOf(BadRequestException);
      answers.push((refusal as BadRequestException).getResponse());
    }
    expect(answers[1]).toEqual(answers[0]);
  });

  it('refuses when the pool phase has no bouts at all', async () => {
    const supabase = mockSupabase({ ...completedPool, matches: { rows: [] } });
    await expect(
      new SwissSeedingService(as(supabase)).rankFromCompletedPools('t1', null),
    ).rejects.toThrow(/needs the pool phase to be complete/);
  });

  it('refuses while any bout is still open', async () => {
    const supabase = mockSupabase({
      ...completedPool,
      matches: {
        rows: [
          { id: 'm1', phase_id: 'pool-1', status: 'completed' },
          { id: 'm2', phase_id: 'pool-1', status: 'in_progress' },
        ],
      },
    });
    const work = new SwissSeedingService(as(supabase)).rankFromCompletedPools('t1', null);
    expect(await refusalOf(work)).toMatchObject({
      code: 'pool_phase_open',
      message: expect.stringMatching(/some bouts are still open/),
    });
  });

  it('snakes across pools: every #1, then every #2', async () => {
    const supabase = mockSupabase({
      ...completedPool,
      pool_members: {
        rows: [
          member('b2', 2, 1),
          member('a1', 1, 0),
          member('b1', 1, 1),
          member('a2', 2, 0),
          // Another phase's pool. Seeded first in its own pool, so a wider
          // read would put a fighter from another phase at the top of the draw.
          member('foreign', 1, 0, 'pool-9'),
        ],
      },
    });
    const { order, sourcePhaseId } = await new SwissSeedingService(
      as(supabase),
    ).rankFromCompletedPools('t1', null);

    expect(order).toEqual(['a1', 'b1', 'a2', 'b2']);
    // Reported even though the caller did not name it — the config schema
    // requires a sourcePhaseId, and this is the only place that knows it.
    expect(sourcePhaseId).toBe('pool-1');
  });

  it('reads the pool phase the caller named, not the first one it finds', async () => {
    // A three-stage tournament can hold more than one pool phase. Naming one
    // has to select it, or the draw is seeded from the wrong results.
    const supabase = mockSupabase({
      phases: {
        rows: [
          { id: 'pool-1', tournament_id: 't1', type: 'pool', status: 'completed' },
          { id: 'pool-2', tournament_id: 't1', type: 'pool', status: 'completed' },
        ],
      },
      matches: {
        rows: [
          { id: 'm1', phase_id: 'pool-1', status: 'completed' },
          { id: 'm2', phase_id: 'pool-2', status: 'completed' },
        ],
      },
      pool_members: {
        rows: [member('from-pool-1', 1, 0, 'pool-1'), member('from-pool-2', 1, 0, 'pool-2')],
      },
    });

    const { order, sourcePhaseId } = await new SwissSeedingService(
      as(supabase),
    ).rankFromCompletedPools('t1', 'pool-2');

    expect(sourcePhaseId).toBe('pool-2');
    expect(order).toEqual(['from-pool-2']);
  });

  it('sorts unseeded members last and breaks ties on pool order', async () => {
    const supabase = mockSupabase({
      ...completedPool,
      pool_members: {
        data: [
          { registration_id: 'unseeded', seed: null, pools: { sort_order: 0 } },
          { registration_id: 'seeded', seed: 1, pools: { sort_order: 5 } },
          { registration_id: 'no-pool-embed', seed: 1, pools: null },
        ],
        error: null,
      },
    });
    const { order } = await new SwissSeedingService(as(supabase)).rankFromCompletedPools(
      't1',
      null,
    );
    // seed 1 / poolOrder 0 (null embed) before seed 1 / poolOrder 5, then null seed.
    expect(order).toEqual(['no-pool-embed', 'seeded', 'unseeded']);
  });

  it('reads the named source phase when one is given', async () => {
    const supabase = mockSupabase({
      phases: { data: [{ id: 'named', type: 'pool', status: 'completed' }], error: null },
      matches: { data: [{ id: 'm1', status: 'completed' }], error: null },
      pool_members: { data: [], error: null },
    });
    const { sourcePhaseId } = await new SwissSeedingService(as(supabase)).rankFromCompletedPools(
      't1',
      'named',
    );
    expect(sourcePhaseId).toBe('named');
    expect(queriedTables(supabase.from)).toEqual(['phases', 'matches', 'pool_members']);
  });

  it('tolerates a null pool_members result', async () => {
    const supabase = mockSupabase({ ...completedPool, pool_members: { data: null, error: null } });
    const { order } = await new SwissSeedingService(as(supabase)).rankFromCompletedPools(
      't1',
      null,
    );
    expect(order).toEqual([]);
  });
});
