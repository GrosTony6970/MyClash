import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { mockSupabase } from '../../common/testing/supabase-chain';
import type { SupabaseService } from '../supabase/supabase.service';
import type { HemaRatingsService } from '../hema-ratings/hema-ratings.service';
import type { SeedableEntrant } from '@myclash/rules/results';
import type { GenerateSwissDto } from './dto/swiss.dto';
import { SwissSeedingService } from './swiss-seeding.service';

const as = (supabase: { service: unknown }): SupabaseService =>
  supabase as unknown as SupabaseService;

const reg = (id: string, hemaRatingsId: string | null = null): SeedableEntrant => ({
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

/** What a refusal sends: its `code`, its English `message`, and any numbers it carries. */
const refusalOf = (work: Promise<unknown>) =>
  work.catch((error: BadRequestException) => error.getResponse());

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
    const work = service.resolveSeeding(
      't1',
      [reg('a', 'h1'), reg('b', 'h2'), reg('c')],
      dto({ seedingStrategy: 'by-rating', minRatingCoveragePercent: 80 }),
    );
    // Coded, with its numbers, for the Swiss screen to say in the reader's language.
    expect(await refusalOf(work)).toMatchObject({
      code: 'rating_coverage_low',
      message: expect.stringMatching(/1 of 3 fighters \(33%\).*below the 80% required/),
      ...{ rated: 1, total: 3, percent: 33, threshold: 80 },
    });
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
