import { describe, expect, it } from 'vitest';
import { priorAssignmentsFromRows } from './prior-assignments';

const POOLS = [
  { id: 'pool-1', matchId: undefined },
  // A synthetic bracket "pool" wrapping a match.
  { id: 'match-pool-9', matchId: 'match-9' },
];

describe('priorAssignmentsFromRows', () => {
  it('maps a manual pool-scoped assignment to a prior keyed by pool id', () => {
    const priors = priorAssignmentsFromRows(
      [
        {
          person_id: 'ref-1',
          pool_id: 'pool-1',
          match_id: null,
          role: 'arbitre_declarant',
          auto_assigned: false,
        },
      ],
      POOLS,
    );
    expect(priors).toEqual([{ poolId: 'pool-1', role: 'arbitre_declarant', personId: 'ref-1' }]);
  });

  it('maps a manual match-scoped assignment to the synthetic bracket pool id', () => {
    const priors = priorAssignmentsFromRows(
      [
        {
          person_id: 'ref-2',
          pool_id: null,
          match_id: 'match-9',
          role: 'arbitre_table',
          auto_assigned: false,
        },
      ],
      POOLS,
    );
    expect(priors).toEqual([{ poolId: 'match-pool-9', role: 'arbitre_table', personId: 'ref-2' }]);
  });

  it('excludes auto-assigned rows (they are regenerated each run)', () => {
    const priors = priorAssignmentsFromRows(
      [
        {
          person_id: 'ref-3',
          pool_id: 'pool-1',
          match_id: null,
          role: 'arbitre_assesseur',
          auto_assigned: true,
        },
      ],
      POOLS,
    );
    expect(priors).toEqual([]);
  });

  it('excludes rows without a role, and match rows that resolve to no pool', () => {
    const priors = priorAssignmentsFromRows(
      [
        {
          person_id: 'ref-4',
          pool_id: 'pool-1',
          match_id: null,
          role: null,
          auto_assigned: false,
        },
        {
          person_id: 'ref-5',
          pool_id: null,
          match_id: 'match-unknown',
          role: 'arbitre_table',
          auto_assigned: false,
        },
      ],
      POOLS,
    );
    expect(priors).toEqual([]);
  });
});
