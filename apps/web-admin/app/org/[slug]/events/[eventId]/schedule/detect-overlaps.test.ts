import { describe, expect, it } from 'vitest';
import { detectScheduleOverlaps, wouldOverlap } from './detect-overlaps';

const T = (h: number, m = 0) => new Date(Date.UTC(2027, 5, 21, h, m)).toISOString();

describe('detectScheduleOverlaps', () => {
  it('returns nothing for back-to-back blocks on one lice', () => {
    expect(
      detectScheduleOverlaps([
        { key: 'a', liceIds: ['l1'], startIso: T(9), endIso: T(9, 30) },
        { key: 'b', liceIds: ['l1'], startIso: T(9, 30), endIso: T(10) },
      ]),
    ).toEqual([]);
  });

  it('flags two blocks overlapping in time on the same lice', () => {
    const out = detectScheduleOverlaps([
      { key: 'a', liceIds: ['l1'], startIso: T(9), endIso: T(9, 30) },
      { key: 'b', liceIds: ['l1'], startIso: T(9, 15), endIso: T(9, 45) },
    ]);
    expect(out).toEqual([{ liceId: 'l1', aKey: 'a', bKey: 'b' }]);
  });

  it('does not flag same-time blocks on different lices', () => {
    expect(
      detectScheduleOverlaps([
        { key: 'a', liceIds: ['l1'], startIso: T(9), endIso: T(9, 30) },
        { key: 'b', liceIds: ['l2'], startIso: T(9), endIso: T(9, 30) },
      ]),
    ).toEqual([]);
  });

  it('flags a wide bracket block overlapping a pool on a shared lice', () => {
    const out = detectScheduleOverlaps([
      { key: 'r16', liceIds: ['l1', 'l2', 'l3'], startIso: T(10), endIso: T(10, 40) },
      { key: 'pool', liceIds: ['l2'], startIso: T(10, 20), endIso: T(11) },
    ]);
    expect(out).toEqual([{ liceId: 'l2', aKey: 'r16', bKey: 'pool' }]);
  });
});

describe('wouldOverlap (prospective drop, slot-based)', () => {
  const occupants = [
    { liceIds: ['l1'], startSlot: 0, endSlot: 6 },
    { liceIds: ['l2'], startSlot: 6, endSlot: 12 },
  ];

  it('is false on an empty lice', () => {
    expect(wouldOverlap({ liceIds: ['l3'], startSlot: 0, endSlot: 6 }, occupants)).toBe(false);
  });

  it('is false for a back-to-back placement on the same lice', () => {
    expect(wouldOverlap({ liceIds: ['l1'], startSlot: 6, endSlot: 12 }, occupants)).toBe(false);
  });

  it('is true when ranges intersect on a shared lice', () => {
    expect(wouldOverlap({ liceIds: ['l1'], startSlot: 3, endSlot: 9 }, occupants)).toBe(true);
  });

  it('is true for a wide placement spanning into an occupied lice', () => {
    expect(wouldOverlap({ liceIds: ['l3', 'l2'], startSlot: 8, endSlot: 10 }, occupants)).toBe(
      true,
    );
  });

  it('ignores the block being moved (excluded by the caller)', () => {
    expect(wouldOverlap({ liceIds: ['l1'], startSlot: 0, endSlot: 6 }, [])).toBe(false);
  });
});
