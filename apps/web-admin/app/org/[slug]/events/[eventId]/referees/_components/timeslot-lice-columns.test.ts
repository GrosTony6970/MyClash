import { describe, expect, it } from 'vitest';
import { NO_LICE, liceColumnsFor } from './timeslot-lice-columns';

const block = (...liceIds: Array<string | null>) => ({
  pools: liceIds.map((liceId) => ({ liceId })),
});

describe('liceColumnsFor', () => {
  it('orders columns by the lices-fetch order, not pool appearance order', () => {
    expect(liceColumnsFor([block('B', 'A')], ['A', 'B'])).toEqual(['A', 'B']);
  });

  it('omits lices no scheduled pool uses', () => {
    expect(liceColumnsFor([block('A')], ['A', 'B', 'C'])).toEqual(['A']);
  });

  it('appends the NO_LICE pseudo-column only when a pool has no lice', () => {
    expect(liceColumnsFor([block('A', null)], ['A'])).toEqual(['A', NO_LICE]);
    expect(liceColumnsFor([block('A')], ['A'])).toEqual(['A']);
  });
});
