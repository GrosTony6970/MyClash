import { describe, expect, it } from 'vitest';
import { detectScheduleOverlaps, wouldOverlap } from './detect-overlaps';

const T = (h: number, m = 0) => new Date(Date.UTC(2027, 5, 21, h, m)).toISOString();

describe('detectScheduleOverlaps', () => {
  it('returns nothing for back-to-back blocks on one lice', () => {
    expect(
      detectScheduleOverlaps([
        { key: 'a', matches: [{ liceId: 'l1', startIso: T(9), durationMinutes: 30 }] },
        { key: 'b', matches: [{ liceId: 'l1', startIso: T(9, 30), durationMinutes: 30 }] },
      ]),
    ).toEqual([]);
  });

  it('flags two blocks overlapping in time on the same lice', () => {
    const out = detectScheduleOverlaps([
      { key: 'a', matches: [{ liceId: 'l1', startIso: T(9), durationMinutes: 30 }] },
      { key: 'b', matches: [{ liceId: 'l1', startIso: T(9, 15), durationMinutes: 30 }] },
    ]);
    expect(out).toEqual([{ liceId: 'l1', aKey: 'a', bKey: 'b' }]);
  });

  it('does not flag same-time blocks on different lices', () => {
    expect(
      detectScheduleOverlaps([
        { key: 'a', matches: [{ liceId: 'l1', startIso: T(9), durationMinutes: 30 }] },
        { key: 'b', matches: [{ liceId: 'l2', startIso: T(9), durationMinutes: 30 }] },
      ]),
    ).toEqual([]);
  });

  it('flags a wide bracket block overlapping a pool on a shared lice', () => {
    const out = detectScheduleOverlaps([
      {
        key: 'r16',
        matches: [
          { liceId: 'l1', startIso: T(10), durationMinutes: 40 },
          { liceId: 'l2', startIso: T(10), durationMinutes: 40 },
          { liceId: 'l3', startIso: T(10), durationMinutes: 40 },
        ],
      },
      { key: 'pool', matches: [{ liceId: 'l2', startIso: T(10, 20), durationMinutes: 40 }] },
    ]);
    expect(out).toEqual([{ liceId: 'l2', aKey: 'r16', bKey: 'pool' }]);
  });

  it('does NOT flag two wide runs that pipeline sequentially on each shared lice', () => {
    // R16 then QF both span l1+l2. Their GLOBAL intervals overlap (R16 09:00–09:10,
    // QF 09:05–09:15) but PER LICE every fight is back-to-back — no real clash.
    // (durationMinutes omitted → 5-min slot fallback.)
    expect(
      detectScheduleOverlaps([
        {
          key: 'r16',
          matches: [
            { liceId: 'l1', startIso: T(9) },
            { liceId: 'l2', startIso: T(9, 5) },
          ],
        },
        {
          key: 'qf',
          matches: [
            { liceId: 'l1', startIso: T(9, 5) },
            { liceId: 'l2', startIso: T(9, 10) },
          ],
        },
      ]),
    ).toEqual([]);
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
