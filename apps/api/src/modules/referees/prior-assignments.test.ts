import { describe, expect, it } from 'vitest';
import { priorAssignmentsFromRows } from './prior-assignments';

const POOLS = [
  { id: 'pool-1', matchIds: undefined },
  // A synthetic bracket "pool" wrapping a single match.
  { id: 'match-pool-9', matchIds: ['match-9'] },
  // A Swiss (round × piste) unit wrapping several consecutive bouts.
  { id: 'swiss-r3-lice-a', matchIds: ['sw-1', 'sw-2', 'sw-3'] },
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

  it('resolves any bout of a Swiss unit to that unit, and emits ONE prior for it', () => {
    // A Swiss assignment persists one row per bout. The engine expects one
    // prior per (unit, role) — N identical priors would over-constrain it.
    const priors = priorAssignmentsFromRows(
      ['sw-1', 'sw-2', 'sw-3'].map((matchId) => ({
        person_id: 'ref-6',
        pool_id: null,
        match_id: matchId,
        role: 'arbitre_declarant',
        auto_assigned: false,
      })),
      POOLS,
    );
    expect(priors).toEqual([
      { poolId: 'swiss-r3-lice-a', role: 'arbitre_declarant', personId: 'ref-6' },
    ]);
  });

  it('keeps distinct roles on the same Swiss unit as separate priors', () => {
    const priors = priorAssignmentsFromRows(
      [
        {
          person_id: 'ref-6',
          pool_id: null,
          match_id: 'sw-1',
          role: 'arbitre_declarant',
          auto_assigned: false,
        },
        {
          person_id: 'ref-7',
          pool_id: null,
          match_id: 'sw-2',
          role: 'arbitre_table',
          auto_assigned: false,
        },
      ],
      POOLS,
    );
    expect(priors).toEqual([
      { poolId: 'swiss-r3-lice-a', role: 'arbitre_declarant', personId: 'ref-6' },
      { poolId: 'swiss-r3-lice-a', role: 'arbitre_table', personId: 'ref-7' },
    ]);
  });
});
