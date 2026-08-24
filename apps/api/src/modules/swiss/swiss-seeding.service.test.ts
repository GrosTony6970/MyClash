import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { mockSupabase, queriedTables } from '../../common/testing/supabase-chain';
import type { SupabaseService } from '../supabase/supabase.service';
import type { HemaRatingsService } from '../hema-ratings/hema-ratings.service';
import type { SeedableRegistration } from '@myclash/rules/results';
import type { GenerateSwissDto } from './dto/swiss.dto';
import { SwissSeedingService } from './swiss-seeding.service';

const as = (supabase: { service: unknown }): SupabaseService =>
  supabase as unknown as SupabaseService;

const reg = (id: string, hemaRatingsId: string | null = null): SeedableRegistration => ({
  id,
  seed: null,
  bibNumber: null,
  hemaRatingsId,
});

const ratingsStub = (ratings: Map<string, number>) =>
  ({
    resolveWeightedRatings: vi.fn().mockResolvedValue(ratings),
  }) as unknown as HemaRatingsService;

const dto = (over: Partial<GenerateSwissDto> = {}): GenerateSwissDto =>
  over as unknown as GenerateSwissDto;

describe('resolveSeeding', () => {
  it('defaults to a random draw and persists the seed for replay', async () => {
    const service = new SwissSeedingService(as(mockSupabase({})));
    const result = await service.resolveSeeding('t1', [reg('a'), reg('b'), reg('c')], dto());

    expect(result.order).toHaveLength(3);
    expect(result.seed).toEqual(expect.any(Number));
    expect(result.coverage).toBeNull();
    expect(result.sourcePhaseId).toBeNull();
  });

  it('replays the same order for the same explicit seed', async () => {
    // The reason the seed is persisted at all — a contested draw has to be
    // reproducible after a regenerate.
    const service = new SwissSeedingService(as(mockSupabase({})));
    const regs = [reg('a'), reg('b'), reg('c'), reg('d')];
    const first = await service.resolveSeeding('t1', regs, dto({ seedingRandomSeed: 4242 }));
    const second = await service.resolveSeeding('t1', regs, dto({ seedingRandomSeed: 4242 }));

    expect(first.seed).toBe(4242);
    expect(second.order).toEqual(first.order);
  });

  it('orders by rating when coverage clears the threshold', async () => {
    // A second tournament fights a different weapon. Reading the wrong row
    // resolves everybody's rating against a weapon they never entered.
    const supabase = mockSupabase({
      tournaments: {
        rows: [
          { id: 't1', weapon: 'longsword' },
          { id: 't9', weapon: 'rapier' },
        ],
      },
    });
    const service = new SwissSeedingService(
      as(supabase),
      ratingsStub(
        new Map([
          ['h1', 1800],
          ['h2', 1500],
        ]),
      ),
    );
    const result = await service.resolveSeeding(
      't1',
      [reg('a', 'h1'), reg('b', 'h2')],
      dto({ seedingStrategy: 'by-rating', minRatingCoveragePercent: 100 }),
    );

    expect(result.order).toEqual(['a', 'b']);
    expect(result.coverage).toEqual({ rated: 2, total: 2, percent: 100 });
    expect(result.seed).toBeNull();
  });

  it('REFUSES a by-rating draw below the coverage threshold rather than degrading', async () => {
    // Falling back to registration order would look like a seeded draw and be
    // defended as one.
    const supabase = mockSupabase({ tournaments: { data: { weapon: 'longsword' }, error: null } });
    const service = new SwissSeedingService(as(supabase), ratingsStub(new Map([['h1', 1800]])));
    await expect(
      service.resolveSeeding(
        't1',
        [reg('a', 'h1'), reg('b', 'h2'), reg('c')],
        dto({ seedingStrategy: 'by-rating', minRatingCoveragePercent: 80 }),
      ),
    ).rejects.toThrow(/1 of 3 fighters \(33%\).*below the 80% required/);
  });

  it('accepts any coverage when no threshold was asked for', async () => {
    const supabase = mockSupabase({ tournaments: { data: { weapon: 'longsword' }, error: null } });
    const service = new SwissSeedingService(as(supabase), ratingsStub(new Map()));
    const result = await service.resolveSeeding(
      't1',
      [reg('a', 'h1')],
      dto({ seedingStrategy: 'by-rating' }),
    );
    expect(result.coverage).toEqual({ rated: 0, total: 1, percent: 0 });
  });
});

describe('ratingsFor', () => {
  it('yields an empty map when the tournament has no weapon', async () => {
    // No weapon means no rating scale; 0% coverage is the honest answer rather
    // than seeding everyone equal.
    const supabase = mockSupabase({ tournaments: { data: { weapon: null }, error: null } });
    const hema = ratingsStub(new Map([['h1', 1800]]));
    const service = new SwissSeedingService(as(supabase), hema);
    const { ratings, coverage } = await service.ratingsFor('t1', [reg('a', 'h1')]);

    expect(ratings.size).toBe(0);
    expect(coverage).toEqual({ rated: 0, total: 1, percent: 0 });
    expect(hema.resolveWeightedRatings).not.toHaveBeenCalled();
  });

  it('yields an empty map when the HemaRatings collaborator is absent', async () => {
    const supabase = mockSupabase({ tournaments: { data: { weapon: 'longsword' }, error: null } });
    const { ratings } = await new SwissSeedingService(as(supabase)).ratingsFor('t1', [
      reg('a', 'h1'),
    ]);
    expect(ratings.size).toBe(0);
  });

  it('passes only the registrations that carry a HEMA id', async () => {
    const supabase = mockSupabase({ tournaments: { data: { weapon: 'longsword' }, error: null } });
    const hema = ratingsStub(new Map([['h1', 1800]]));
    await new SwissSeedingService(as(supabase), hema).ratingsFor('t1', [
      reg('a', 'h1'),
      reg('b', null),
    ]);
    expect(hema.resolveWeightedRatings).toHaveBeenCalledWith(['h1'], 'longsword');
  });

  it('reports 0% rather than dividing by zero on an empty field', async () => {
    const supabase = mockSupabase({ tournaments: { data: { weapon: 'longsword' }, error: null } });
    const { coverage } = await new SwissSeedingService(
      as(supabase),
      ratingsStub(new Map()),
    ).ratingsFor('t1', []);
    expect(coverage).toEqual({ rated: 0, total: 0, percent: 0 });
  });

  it('tolerates a missing tournament row', async () => {
    const supabase = mockSupabase({ tournaments: { data: null, error: null } });
    const { ratings } = await new SwissSeedingService(
      as(supabase),
      ratingsStub(new Map([['h1', 1]])),
    ).ratingsFor('t1', [reg('a', 'h1')]);
    expect(ratings.size).toBe(0);
  });
});

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
    await expect(
      new SwissSeedingService(as(supabase)).rankFromCompletedPools('t1', null),
    ).rejects.toThrow(/needs a pool phase/);
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
    await expect(
      new SwissSeedingService(as(supabase)).rankFromCompletedPools('t1', null),
    ).rejects.toThrow(/some bouts are still open/);
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

describe('loadRegistrations', () => {
  it('flattens the nested person -> global_person rating id', async () => {
    const supabase = mockSupabase({
      registrations: {
        data: [
          {
            id: 'r1',
            seed: 3,
            bib_number: 7,
            persons: { global_persons: { hema_ratings_id: 'h1' } },
          },
        ],
        error: null,
      },
    });
    await expect(new SwissSeedingService(as(supabase)).loadRegistrations('t1')).resolves.toEqual([
      { id: 'r1', seed: 3, bibNumber: 7, hemaRatingsId: 'h1' },
    ]);
  });

  it('nulls every optional field that is absent', async () => {
    const supabase = mockSupabase({
      registrations: {
        data: [
          { id: 'r1', seed: null, bib_number: null, persons: null },
          { id: 'r2', persons: { global_persons: null } },
        ],
        error: null,
      },
    });
    await expect(new SwissSeedingService(as(supabase)).loadRegistrations('t1')).resolves.toEqual([
      { id: 'r1', seed: null, bibNumber: null, hemaRatingsId: null },
      { id: 'r2', seed: null, bibNumber: null, hemaRatingsId: null },
    ]);
  });

  it('throws BadRequest on a read error', async () => {
    const supabase = mockSupabase({
      registrations: { data: null, error: { message: 'registrations read failed' } },
    });
    await expect(new SwissSeedingService(as(supabase)).loadRegistrations('t1')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('tolerates a null result', async () => {
    const supabase = mockSupabase({ registrations: { data: null, error: null } });
    await expect(new SwissSeedingService(as(supabase)).loadRegistrations('t1')).resolves.toEqual(
      [],
    );
  });
});
