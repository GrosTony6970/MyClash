import { describe, expect, it } from 'vitest';
import {
  ANY_AVAILABILITY,
  boutsOnDay,
  checkAssignments,
  type RefereeTarget,
} from './referee-checker';
import {
  ALL_OFF,
  ALL_ON,
  LEA,
  check,
  codes,
  duty,
  poolB,
  w,
} from '../../test/referee-checker-fixtures';

// Pool B is slot 1 of day 0 (10:00). A duty at 08:00 is slot 0, one at 14:00 slot 2.
const morning = (extra: Parameters<typeof duty>[2] = {}) =>
  duty('pool-a', w(0, 60), { slot: 0, dayIndex: 0, matchIds: ['a1', 'a2'], ...extra });

describe('rest (Discouraged, restSlots — ADR-019)', () => {
  it('fires on a duty in the slot next to the target, against that duty', () => {
    const v = check([morning()]);
    expect(v.level).toBe('discouraged');
    expect(v.reasons).toEqual([
      {
        code: 'rest',
        level: 'discouraged',
        against: { kind: 'unit', id: 'pool-a', label: 'unit pool-a' },
        confirmed: false,
      },
    ]);
  });

  it('counts slots, not minutes: a long lunch between two slots changes nothing', () => {
    const after = duty('pool-c', w(360, 420), { slot: 2, dayIndex: 0 });
    expect(codes(check([after]))).toEqual(['rest']);
  });

  it('reaches as far as restSlots, and no further', () => {
    const far = duty('pool-d', w(420, 480), { slot: 3, dayIndex: 0 });
    expect(codes(check([far]))).toEqual([]);
    expect(codes(check([far], poolB, { ...ALL_ON, restSlots: 2 }))).toEqual(['rest']);
  });

  it('never fires within one slot (that is an overlap), across days, or without a slot', () => {
    const sameSlot = duty('pool-e', w(200, 230), { slot: 1, dayIndex: 0 });
    const nextDay = morning({ dayIndex: 1 });
    const bracketBout = morning({ slot: null });
    expect(codes(check([sameSlot, nextDay, bracketBout]))).toEqual([]);
    expect(codes(check([morning()], { ...poolB, slot: null }))).toEqual([]);
  });

  it('leaves a duty on the target to two_roles', () => {
    const onTarget = duty('pool-b', w(120, 180), { poolId: 'pool-b', slot: 0, dayIndex: 0 });
    expect(codes(check([onTarget]))).toEqual(['two_roles']);
  });

  it('is off at 0', () => {
    expect(codes(check([morning()], poolB, { ...ALL_ON, restSlots: 0 }))).toEqual([]);
  });
});

describe('cap (Discouraged, maxBoutsPerDay — ADR-019)', () => {
  const capAt = (max: number) => ({ ...ALL_OFF, maxBoutsPerDay: max });

  it('fires when the day would pass the cap, with the day and its total', () => {
    const v = check([morning()], poolB, capAt(3));
    expect(v.reasons).toEqual([
      {
        code: 'cap',
        level: 'discouraged',
        against: { kind: 'day', id: '0', label: '4' },
        confirmed: false,
      },
    ]);
  });

  it('allows exactly the cap', () => {
    expect(codes(check([morning()], poolB, capAt(4)))).toEqual([]);
  });

  it('counts a bout once for two roles, and only the target day', () => {
    const second = morning({ role: 'table' });
    const otherDay = duty('pool-x', w(1500, 1560), { dayIndex: 1, matchIds: ['x1', 'x2', 'x3'] });
    expect(codes(check([morning(), second, otherDay], poolB, capAt(4)))).toEqual([]);
  });

  it('counts nothing without a day, on either side', () => {
    const untimed = morning({ dayIndex: null });
    expect(codes(check([untimed], poolB, capAt(2)))).toEqual([]);
    expect(codes(check([morning()], { ...poolB, dayIndex: null }, capAt(1)))).toEqual([]);
    expect(boutsOnDay([morning()], null, ['b1'])).toBe(0);
  });

  it('is off at 0', () => {
    expect(codes(check([morning()], poolB, capAt(0)))).toEqual([]);
  });
});

describe('checkAssignments keeps a per-bout crew whole for the cap', () => {
  // Léa holds Pool B's declarant seat bout by bout: three rows, three bout targets.
  const bout = (id: string, from: number): RefereeTarget => ({
    ...poolB,
    scope: 'match',
    matchIds: [id],
    window: w(from, from + 10),
  });
  const rows = ['b1', 'b2', 'b3'].map((id, i) => ({
    id,
    personId: LEA,
    target: bout(id, 120 + i * 20),
  }));
  const commitments = rows.map((r) =>
    duty('pool-b', r.target.window, {
      poolId: 'pool-b',
      matchId: r.id,
      role: 'declarant',
      slot: 1,
      dayIndex: 0,
    }),
  );

  it('re-judges each bout with its siblings: the day holds three bouts', () => {
    const verdicts = checkAssignments(rows, commitments, () => ANY_AVAILABILITY, {
      ...ALL_ON,
      maxBoutsPerDay: 2,
    });
    expect([...verdicts.values()].map(codes)).toEqual([['cap'], ['cap'], ['cap']]);
  });

  it('and the siblings raise nothing else', () => {
    const verdicts = checkAssignments(rows, commitments, () => ANY_AVAILABILITY, ALL_ON);
    expect([...verdicts.values()].map(codes)).toEqual([[], [], []]);
  });
});
