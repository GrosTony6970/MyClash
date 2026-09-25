import { describe, expect, it } from 'vitest';
import {
  ANY_AVAILABILITY,
  FINE,
  checkAssignments,
  markConfirmed,
  mergeVerdicts,
  parseStoredReasons,
  toStoredReasons,
  type RefereeCommitment,
} from './referee-checker';
import {
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

describe('Workshops', () => {
  const session = (
    kind: 'teach' | 'attend',
    window: ReturnType<typeof w> | null,
  ): RefereeCommitment => ({
    kind,
    personId: LEA,
    sessionId: 'cutting',
    window,
    label: 'Cutting 101',
  });

  it('teaching at an overlapping time is Impossible', () => {
    expect(check([session('teach', w(170, 230))]).reasons).toEqual([
      {
        code: 'teaches_overlap',
        level: 'impossible',
        against: { kind: 'workshop', id: 'cutting', label: 'Cutting 101' },
        confirmed: false,
      },
    ]);
  });

  it('attending is Discouraged, and off with its switch', () => {
    expect(check([session('attend', w(170, 230))]).level).toBe('discouraged');
    expect(
      check([session('attend', w(170, 230))], poolB, { ...ALL_ON, attendWorkshop: false }).level,
    ).toBe('fine');
  });

  it('an untimed session overlaps nothing', () => {
    expect(check([session('teach', null)]).level).toBe('fine');
  });
});

describe('outside_availability', () => {
  it('fires for a Tournament outside the allow-list', () => {
    const v = check([], poolB, ALL_ON, { tournamentIds: ['sabre'], dayIndices: null });
    expect(v.reasons).toEqual([
      { code: 'outside_availability', level: 'impossible', against: null, confirmed: false },
    ]);
  });

  it('fires for a day outside the allow-list, once even when both miss', () => {
    expect(codes(check([], poolB, ALL_ON, { tournamentIds: null, dayIndices: [1] }))).toEqual([
      'outside_availability',
    ]);
    expect(codes(check([], poolB, ALL_ON, { tournamentIds: ['sabre'], dayIndices: [1] }))).toEqual([
      'outside_availability',
    ]);
  });

  it('cannot judge the day of an untimed target, and allows a listed one', () => {
    expect(
      check([], { ...poolB, dayIndex: null }, ALL_ON, { tournamentIds: null, dayIndices: [1] })
        .level,
    ).toBe('fine');
    expect(check([], poolB, ALL_ON, { tournamentIds: ['longsword'], dayIndices: [0] }).level).toBe(
      'fine',
    );
  });
});

describe('checkAssignments', () => {
  it('re-judges each row without its own duty, so a later move shows', () => {
    const own = duty('pool-b', w(120, 180), { poolId: 'pool-b', role: 'declarant' });
    const verdicts = checkAssignments(
      [{ id: 'row-1', personId: LEA, target: poolB }],
      [own, fight('x1', 'pool-x', w(150, 155))],
      () => ANY_AVAILABILITY,
      ALL_ON,
    );
    expect(codes(verdicts.get('row-1')!)).toEqual(['fights_overlap']);
  });

  it('asks each person their own availability', () => {
    const verdicts = checkAssignments(
      [
        { id: 'a', personId: LEA, target: poolB },
        { id: 'b', personId: 'paul', target: poolB },
      ],
      [],
      (p) => (p === LEA ? { tournamentIds: ['sabre'], dayIndices: null } : ANY_AVAILABILITY),
      ALL_ON,
    );
    expect(verdicts.get('a')!.level).toBe('impossible');
    expect(verdicts.get('b')!.level).toBe('fine');
  });
});

describe('confirmed-over reasons (ruling 135)', () => {
  const amber = check([fightPool('pool-b', w(120, 180))]);

  it('marks a stored reason (code + label) confirmed, and it stops being a warning', () => {
    const v = markConfirmed(amber, [{ code: 'own_pool', label: 'Pool pool-b' }]);
    expect(v.level).toBe('fine');
    expect(v.reasons[0]!.confirmed).toBe(true);
  });

  it('does not match the same code against another name', () => {
    const v = markConfirmed(amber, [{ code: 'own_pool', label: 'Pool pool-q' }]);
    expect(v.level).toBe('discouraged');
    expect(v.reasons[0]!.confirmed).toBe(false);
  });

  it('never confirms an Impossible reason', () => {
    const red = check([fight('x1', 'pool-x', w(150, 155))]);
    const v = markConfirmed(red, [{ code: 'fights_overlap', label: 'bout x1' }]);
    expect(v.level).toBe('impossible');
    expect(v.reasons[0]!.confirmed).toBe(false);
  });

  it('stores the Discouraged reasons by code and data name, never an id', () => {
    const v = check([fightPool('pool-b', w(120, 180)), fight('x1', 'pool-x', w(150, 155))]);
    expect(toStoredReasons(v)).toEqual([{ code: 'own_pool', label: 'Pool pool-b' }]);
  });

  it('merges two verdicts on one crew: every reason once, the worst level, confirmed if either', () => {
    const a = markConfirmed(check([fightPool('pool-b', w(120, 180))]), [
      { code: 'own_pool', label: 'Pool pool-b' },
    ]);
    const b = check([fightPool('pool-b', w(120, 180)), fight('x1', 'pool-x', w(150, 155))]);
    const merged = mergeVerdicts(a, b);
    expect(merged.level).toBe('impossible');
    expect(merged.reasons.map((r) => [r.code, r.confirmed])).toEqual([
      ['own_pool', true],
      ['fights_overlap', false],
    ]);
    expect(mergeVerdicts(FINE, a)).toEqual(a);
  });

  it('reads back only well-formed stored reasons', () => {
    expect(
      parseStoredReasons([
        { code: 'own_pool', label: 'A' },
        { code: 'nope', label: 'B' },
        'x',
        { code: 'two_roles' },
      ]),
    ).toEqual([{ code: 'own_pool', label: 'A' }]);
    expect(parseStoredReasons(null)).toEqual([]);
  });
});
