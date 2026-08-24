/**
 * The point-value aggregation, tested where it lives.
 *
 * Moved out of `stats.service.test.ts` with the module it covers, when that file
 * crossed the size budget. This is a pure transform of rows already fetched, so
 * every case here is a plain object literal and no Supabase double is needed.
 */
import { describe, expect, it } from 'vitest';
import { aggregateTargetValues } from './target-value-stats';

describe('aggregateTargetValues', () => {
  const tv = (o: Partial<Parameters<typeof aggregateTargetValues>[0][number]>) => ({
    registrationId: 'r',
    personId: 'p',
    givenName: 'A',
    familyName: 'B',
    clubName: null as string | null,
    pointValue: 1,
    cleanHits: 1,
    ...o,
  });

  it('returns nulls/empties for no rows', () => {
    expect(aggregateTargetValues([])).toEqual({
      maxValue: null,
      distribution: [],
      hunters: [],
    });
  });

  it('derives maxValue = highest value present (supports 3) and sorts distribution asc', () => {
    const res = aggregateTargetValues([
      tv({ personId: 'p1', pointValue: 2, cleanHits: 5 }),
      tv({ personId: 'p2', pointValue: 1, cleanHits: 3 }),
      tv({ personId: 'p3', pointValue: 3, cleanHits: 2 }),
    ]);
    expect(res.maxValue).toBe(3);
    expect(res.distribution).toEqual([
      { value: 1, cleanHits: 3 },
      { value: 2, cleanHits: 5 },
      { value: 3, cleanHits: 2 },
    ]);
  });

  it('ranks hunters by clean hits AT maxValue, ties by name, top 5', () => {
    const res = aggregateTargetValues([
      tv({ personId: 'p1', givenName: 'Zoe', familyName: '', pointValue: 2, cleanHits: 4 }),
      tv({ personId: 'p2', givenName: 'Amy', familyName: '', pointValue: 2, cleanHits: 4 }),
      tv({ personId: 'p3', givenName: 'Bo', familyName: '', pointValue: 2, cleanHits: 7 }),
      tv({ personId: 'p4', givenName: 'Cy', familyName: '', pointValue: 1, cleanHits: 9 }),
    ]);
    expect(res.maxValue).toBe(2);
    // Bo (7) leads; tie at 4 broken by name → Amy before Zoe; p4 excluded (value 1 ≠ maxValue).
    expect(res.hunters.map((h) => h.name)).toEqual(['Bo', 'Amy', 'Zoe']);
  });

  it('merges the same person across tournaments (sum clean hits at maxValue, keep club)', () => {
    const res = aggregateTargetValues([
      tv({ personId: 'p1', givenName: 'Ann', familyName: 'R', pointValue: 2, cleanHits: 3 }),
      tv({
        personId: 'p1',
        givenName: 'Ann',
        familyName: 'R',
        pointValue: 2,
        cleanHits: 2,
        clubName: 'Lyon',
      }),
    ]);
    expect(res.hunters).toHaveLength(1);
    expect(res.hunters[0]).toMatchObject({ personId: 'p1', cleanHits: 5, club: 'Lyon' });
  });
});
