import { describe, expect, it } from 'vitest';
import {
  detectConcurrencyShortage,
  detectRefereeConflicts,
  findTimeConflict,
  type RefereeCommitmentPool,
  type RefereeForCapacity,
} from './referee-conflicts';

function pool(over: Partial<RefereeCommitmentPool> & { id: string }): RefereeCommitmentPool {
  return {
    name: over.id,
    tournamentId: 't1',
    tournamentName: 'Longsword',
    scheduledStart: null,
    scheduledEnd: null,
    liceName: null,
    roleSlotCount: 3,
    fighterPersonIds: [],
    assignments: [],
    ...over,
  };
}

const WIN = { scheduledStart: '2027-06-22T11:00:00Z', scheduledEnd: '2027-06-22T13:24:00Z' };

describe('detectRefereeConflicts', () => {
  it('flags a referee officiating one pool while fighting another at an overlapping time', () => {
    const pools = [
      pool({
        id: 'p1',
        name: 'Pool 1',
        ...WIN,
        assignments: [{ personId: 'jf', personName: 'J-F Biras', role: 'arbitre_table' }],
      }),
      pool({ id: 'p2', name: 'Pool 2', ...WIN, fighterPersonIds: ['jf'] }),
    ];

    const conflicts = detectRefereeConflicts(pools);

    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({
      personId: 'jf',
      kind: 'officiate_vs_fight',
      poolId: 'p1',
      otherPoolId: 'p2',
    });
  });

  it('detects the overlap across different tournaments', () => {
    const pools = [
      pool({
        id: 'lsw1',
        tournamentId: 'longsword',
        ...WIN,
        assignments: [{ personId: 'jf', personName: 'J-F Biras', role: 'arbitre_table' }],
      }),
      pool({ id: 'sdw1', tournamentId: 'sidesword', ...WIN, fighterPersonIds: ['jf'] }),
    ];
    expect(detectRefereeConflicts(pools)).toHaveLength(1);
  });

  it('does not flag non-overlapping or unscheduled pools', () => {
    const morning = pool({
      id: 'p1',
      ...WIN,
      assignments: [{ personId: 'jf', personName: 'J-F Biras', role: 'arbitre_table' }],
    });
    const afternoon = pool({
      id: 'p2',
      scheduledStart: '2027-06-22T14:00:00Z',
      scheduledEnd: '2027-06-22T16:00:00Z',
      fighterPersonIds: ['jf'],
    });
    const unscheduled = pool({ id: 'p3', fighterPersonIds: ['jf'] });
    expect(detectRefereeConflicts([morning, afternoon])).toHaveLength(0);
    expect(detectRefereeConflicts([morning, unscheduled])).toHaveLength(0);
  });

  it('flags a referee double-booked to officiate two overlapping pools (once)', () => {
    const assign = [{ personId: 'cb', personName: 'Charles Biron', role: 'arbitre_assesseur' }];
    const pools = [
      pool({ id: 'p1', name: 'Pool 1', ...WIN, assignments: assign }),
      pool({ id: 'p2', name: 'Pool 2', ...WIN, assignments: assign }),
    ];
    const conflicts = detectRefereeConflicts(pools);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({ personId: 'cb', kind: 'double_booked' });
  });
});

describe('findTimeConflict', () => {
  const pools = [
    pool({ id: 'p1', name: 'Pool 1', ...WIN }),
    pool({ id: 'p2', name: 'Pool 2', ...WIN, fighterPersonIds: ['jf'] }),
  ];

  it('returns the collision when assigning a referee who fights an overlapping pool', () => {
    expect(findTimeConflict('jf', 'p1', pools)).toMatchObject({
      kind: 'officiate_vs_fight',
      otherPoolName: 'Pool 2',
    });
  });

  it('returns null for a referee with no overlapping commitment', () => {
    expect(findTimeConflict('clean', 'p1', pools)).toBeNull();
  });

  it('returns null for fighting in the target pool itself (the kept block owns that case)', () => {
    const ownPool = [pool({ id: 'p1', name: 'Pool 1', ...WIN, fighterPersonIds: ['jf'] })];
    expect(findTimeConflict('jf', 'p1', ownPool)).toBeNull();
  });
});

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
