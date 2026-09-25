import { describe, expect, it } from 'vitest';
import {
  detectConcurrencyShortage,
  type RefereeCommitmentPool,
  type RefereeForCapacity,
} from './referee-capacity';

function pool(over: Partial<RefereeCommitmentPool> & { id: string }): RefereeCommitmentPool {
  return {
    tournamentId: 't1',
    scheduledStart: null,
    scheduledEnd: null,
    roleSlotCount: 3,
    fighterPersonIds: [],
    ...over,
  };
}

const WIN = { scheduledStart: '2027-06-22T11:00:00Z', scheduledEnd: '2027-06-22T13:24:00Z' };

describe('detectConcurrencyShortage', () => {
  const threeParallel = [
    pool({ id: 'p1', ...WIN, roleSlotCount: 3 }),
    pool({ id: 'p2', ...WIN, roleSlotCount: 3 }),
    pool({ id: 'p3', ...WIN, roleSlotCount: 3 }),
  ];
  const refs = (n: number): RefereeForCapacity[] =>
    Array.from({ length: n }, (_, i) => ({ personId: `r${i}`, roles: ['arbitre_table'] }));
  const day0 = () => 0;

  it('warns when parallel pools need more slots than there are free referees', () => {
    const warnings = detectConcurrencyShortage(threeParallel, refs(6), day0);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({ needed: 9, free: 6, liceCount: 3 });
  });

  it('does not warn when enough referees are free', () => {
    expect(detectConcurrencyShortage(threeParallel, refs(12), day0)).toHaveLength(0);
  });

  it('counts a referee fighting in an active pool as not free', () => {
    const pools = [
      pool({ id: 'p1', ...WIN, roleSlotCount: 3 }),
      pool({ id: 'p2', ...WIN, roleSlotCount: 3, fighterPersonIds: ['r0', 'r1'] }),
    ];
    // 6 slots needed; 4 refs but 2 are fighting → only 2 free.
    const warnings = detectConcurrencyShortage(pools, refs(4), day0);
    expect(warnings[0]).toMatchObject({ needed: 6, free: 2 });
  });
});
