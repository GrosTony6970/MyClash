import { describe, expect, it } from 'vitest';
import {
  REFEREE_REASON_CODES,
  levelOf,
  type RefereeCommitment,
  type RefereeTarget,
} from './referee-checker';
import {
  ALL_OFF,
  ALL_ON,
  LEA,
  check,
  codes,
  duty,
  fight,
  fightPool,
  poolB,
  w,
} from '../../test/referee-checker-fixtures';

describe('levels', () => {
  it('splits the codes into the two ADR-016 levels', () => {
    expect(REFEREE_REASON_CODES.filter((c) => levelOf(c) === 'impossible')).toEqual([
      'own_match',
      'fights_overlap',
      'referees_overlap',
      'teaches_overlap',
      'outside_availability',
    ]);
    expect(REFEREE_REASON_CODES.filter((c) => levelOf(c) === 'discouraged')).toEqual([
      'own_pool',
      'own_pool_span',
      'two_roles',
      'attends_overlap',
    ]);
  });

  it('is fine with no commitments', () => {
    expect(check([])).toEqual({ level: 'fine', reasons: [] });
  });

  it('takes the worst level and returns every reason', () => {
    const v = check([fight('x1', 'pool-x', w(150, 155)), fightPool('pool-b', w(120, 180))]);
    expect(v.level).toBe('impossible');
    expect(codes(v)).toEqual(['fights_overlap', 'own_pool']);
  });

  it("ignores another person's commitments", () => {
    const other = { ...fight('x1', 'pool-x', w(150, 155)), personId: 'paul' };
    expect(check([other]).level).toBe('fine');
  });
});

describe('own_match', () => {
  const bout: RefereeTarget = {
    ...poolB,
    scope: 'match',
    unitId: 'b1',
    matchIds: ['b1'],
    window: w(125, 130),
  };

  it('fires on a bout Léa fights in, with or without a time', () => {
    const v = check([fight('b1', 'pool-b')], bout);
    expect(v.reasons).toEqual([
      {
        code: 'own_match',
        level: 'impossible',
        against: { kind: 'match', id: 'b1', label: 'bout b1' },
        confirmed: false,
      },
    ]);
    expect(codes(check([fight('b1', 'pool-b', null)], { ...bout, window: null }))).toEqual([
      'own_match',
    ]);
  });

  it('does not fire on a Pool-scoped target (that is own_pool)', () => {
    expect(codes(check([fight('b1', 'pool-b'), fightPool('pool-b', w(120, 180))]))).toEqual([
      'own_pool',
    ]);
  });

  it('replaces own_pool on her own bout of her Pool', () => {
    expect(codes(check([fight('b1', 'pool-b'), fightPool('pool-b', w(120, 180))], bout))).toEqual([
      'own_match',
    ]);
  });
});

describe('fights_overlap', () => {
  it('fires on a bout elsewhere that overlaps the target', () => {
    const v = check([fight('x1', 'pool-x', w(170, 175))]);
    expect(v.reasons[0]).toMatchObject({
      code: 'fights_overlap',
      against: { kind: 'match', id: 'x1' },
    });
  });

  it('does not fire on touching windows (half-open)', () => {
    expect(check([fight('x1', 'pool-x', w(180, 185))], poolB, ALL_OFF).level).toBe('fine');
    expect(check([fight('x1', 'pool-x', w(115, 120))], poolB, ALL_OFF).level).toBe('fine');
  });

  it('skips an untimed bout and an untimed target', () => {
    expect(check([fight('x1', 'pool-x', null)], poolB, ALL_OFF).level).toBe('fine');
    expect(check([fight('x1', 'pool-x')], { ...poolB, window: null }, ALL_OFF).level).toBe('fine');
  });

  it("leaves Léa's bouts inside the target's own Pool to own_pool", () => {
    expect(check([fight('b2', 'pool-b', w(140, 145))], poolB, ALL_OFF).level).toBe('fine');
  });

  it('fires on a bout of her own Pool dragged to another piste at the same time (hard rule 8)', () => {
    const b2: RefereeTarget = { ...poolB, scope: 'match', unitId: 'b2', matchIds: ['b2'] };
    const v = check([fight('b1', 'pool-b', w(125, 130)), fightPool('pool-b', w(120, 180))], {
      ...b2,
      window: w(125, 130),
    });
    expect(v.level).toBe('impossible');
    expect(codes(v)).toEqual(['fights_overlap', 'own_pool']);
  });

  it('fires on a bracket bout (no Pool) that overlaps', () => {
    expect(codes(check([fight('q1', null, w(130, 135))], poolB, ALL_OFF))).toEqual([
      'fights_overlap',
    ]);
  });

  it('has no venue carve-out: two halls at one time is still two places (ADR-016)', () => {
    // The checker takes no venue at all; the other bout is in another hall.
    expect(check([fight('hall2', 'pool-z', w(125, 130))], poolB, ALL_OFF).level).toBe('impossible');
  });
});

describe('own_pool (Discouraged, switch ownPool)', () => {
  it('fires when Léa fights in the target Pool', () => {
    const v = check([fightPool('pool-b', w(120, 180))]);
    expect(v).toEqual({
      level: 'discouraged',
      reasons: [
        {
          code: 'own_pool',
          level: 'discouraged',
          against: { kind: 'pool', id: 'pool-b', label: 'Pool pool-b' },
          confirmed: false,
        },
      ],
    });
  });

  it('fires on a bout of her Pool that is not hers', () => {
    const b2: RefereeTarget = {
      ...poolB,
      scope: 'match',
      unitId: 'b2',
      matchIds: ['b2'],
      window: w(140, 145),
    };
    expect(codes(check([fight('b1', 'pool-b'), fightPool('pool-b', w(120, 180))], b2))).toEqual([
      'own_pool',
    ]);
  });

  it('is fine when its switch is off', () => {
    expect(
      check([fightPool('pool-b', w(120, 180))], poolB, { ...ALL_ON, ownPool: false }).level,
    ).toBe('fine');
  });
});

describe('own_pool_span (Discouraged, switch ownPoolSpan — ruling 5)', () => {
  it('fires when a Pool she fights in runs during the target, none of her bouts overlapping', () => {
    // Pool A 09:30–10:45; her bouts at 09:35 and 10:40; asked to referee Pool B's 10:00–11:00.
    const v = check([fightPool('pool-a', w(90, 165)), fight('a1', 'pool-a', w(95, 100))]);
    expect(v.level).toBe('discouraged');
    expect(v.reasons).toEqual([
      {
        code: 'own_pool_span',
        level: 'discouraged',
        against: { kind: 'pool', id: 'pool-a', label: 'Pool pool-a' },
        confirmed: false,
      },
    ]);
  });

  it('gives way to fights_overlap when one of her bouts of that Pool overlaps', () => {
    const v = check([fightPool('pool-a', w(90, 165)), fight('a2', 'pool-a', w(160, 165))]);
    expect(codes(v)).toEqual(['fights_overlap']);
  });

  it('does not fire on touching hulls, untimed Pools, or with its switch off', () => {
    expect(check([fightPool('pool-a', w(60, 120))]).level).toBe('fine');
    expect(check([fightPool('pool-a', null)]).level).toBe('fine');
    expect(
      check([fightPool('pool-a', w(90, 165))], poolB, { ...ALL_ON, ownPoolSpan: false }).level,
    ).toBe('fine');
  });
});

describe('a Swiss round is a group, not a Pool', () => {
  // Round 3 on piste 1, 10:00–10:30. Léa fights round 3 on piste 2.
  const r3p1: RefereeTarget = {
    scope: 'match',
    unitId: 'swiss-r3-p1',
    poolId: null,
    groupId: 'round-3',
    matchIds: ['s1', 's2'],
    window: w(120, 150),
    role: 'declarant',
    tournamentId: 'longsword',
    dayIndex: 0,
  };
  const swissBout = (matchId: string, window: ReturnType<typeof w>): RefereeCommitment => ({
    kind: 'fight',
    personId: LEA,
    matchId,
    groupId: 'round-3',
    window,
    label: `bout ${matchId}`,
  });

  it('her round at another time is own_pool (the round rule the board always had)', () => {
    const v = check([swissBout('s9', w(160, 170)), fightPool('round-3', w(120, 170))], r3p1);
    expect(codes(v)).toEqual(['own_pool']);
  });

  it('her bout of the same round on another piste at the same time is Impossible', () => {
    const v = check([swissBout('s8', w(125, 135)), fightPool('round-3', w(120, 170))], r3p1);
    expect(codes(v)).toEqual(['fights_overlap', 'own_pool']);
    expect(v.level).toBe('impossible');
  });
});

describe('referees_overlap and two_roles', () => {
  it('fires on another duty that overlaps, in any hall', () => {
    const v = check([duty('pool-x', w(170, 200), { poolId: 'pool-x' })]);
    expect(v.reasons).toEqual([
      {
        code: 'referees_overlap',
        level: 'impossible',
        against: { kind: 'unit', id: 'pool-x', label: 'unit pool-x' },
        confirmed: false,
      },
    ]);
  });

  it('does not fire on a touching duty or an untimed one', () => {
    expect(check([duty('pool-x', w(180, 200))]).level).toBe('fine');
    expect(check([duty('pool-x', null)]).level).toBe('fine');
  });

  it('calls a duty ON the target two_roles when its role differs, nothing when it is the same', () => {
    expect(
      codes(check([duty('pool-b', w(120, 180), { poolId: 'pool-b', role: 'table' })])),
    ).toEqual(['two_roles']);
    expect(
      check([duty('pool-b', w(120, 180), { poolId: 'pool-b', role: 'declarant' })]).level,
    ).toBe('fine');
  });

  it('counts a bout duty of the same Pool as on the target (a per-Pool crew is written per bout)', () => {
    const perBout = duty('b1', w(125, 130), { poolId: 'pool-b', matchId: 'b1', role: 'table' });
    expect(codes(check([perBout]))).toEqual(['two_roles']);
  });

  it("counts the Pool's own crew row as on a bout target of that Pool", () => {
    const b2: RefereeTarget = {
      ...poolB,
      scope: 'match',
      unitId: 'b2',
      matchIds: ['b2'],
      window: w(140, 145),
    };
    const crew = duty('pool-b', w(120, 180), { poolId: 'pool-b', role: 'table' });
    expect(codes(check([crew], b2))).toEqual(['two_roles']);
  });

  it('is fine for two roles when the switch is off', () => {
    expect(
      check([duty('pool-b', w(120, 180), { poolId: 'pool-b', role: 'table' })], poolB, ALL_OFF)
        .level,
    ).toBe('fine');
  });

  it('reports a Swiss crew held as one row per bout once', () => {
    const rows = [
      duty('swiss-r2-p1', w(130, 140), { matchId: 's1' }),
      duty('swiss-r2-p1', w(140, 150), { matchId: 's2' }),
    ];
    expect(codes(check(rows))).toEqual(['referees_overlap']);
  });
});
