import { describe, expect, it } from 'vitest';
import { extractBronzeMatch } from './bracket-bronze';

interface Slot {
  id: string;
  round: number;
  position: number;
}

/** Positions start at 1, as `single-elim.ts` generates them: the Final is 1, the bronze 2. */
function slot(id: string, round: number, position: number): Slot {
  return { id, round, position };
}

describe('extractBronzeMatch', () => {
  it('extracts the position-2 slot at the max round as the bronze match', () => {
    const slots: Slot[] = [
      slot('qf-1', 1, 1),
      slot('sf-1', 2, 1),
      slot('sf-2', 2, 2),
      slot('final', 3, 1),
      slot('bronze', 3, 2),
    ];

    const { bronze, mainSlots } = extractBronzeMatch(slots, 'single_elim');

    expect(bronze?.id).toBe('bronze');
    expect(mainSlots.map((s) => s.id)).toEqual(['qf-1', 'sf-1', 'sf-2', 'final']);
  });

  it('returns bronze=null and mainSlots=[] for an empty array', () => {
    const { bronze, mainSlots } = extractBronzeMatch([], 'single_elim');
    expect(bronze).toBeNull();
    expect(mainSlots).toEqual([]);
  });

  it('returns bronze=null when no slot matches position=2 at the max round', () => {
    // Two fighters: the Final is the only bout, and there is no bronze.
    const slots: Slot[] = [slot('final', 1, 1)];

    const { bronze, mainSlots } = extractBronzeMatch(slots, 'single_elim');

    expect(bronze).toBeNull();
    expect(mainSlots).toHaveLength(1);
  });

  it('does NOT match a position-2 slot at a non-max round', () => {
    // The second semi-final is position 2 too, one round before the Final: a bronze is by
    // definition in the Final's round.
    const slots: Slot[] = [slot('sf-1', 2, 1), slot('sf-2', 2, 2), slot('final', 3, 1)];

    const { bronze, mainSlots } = extractBronzeMatch(slots, 'single_elim');

    expect(bronze).toBeNull();
    expect(mainSlots.map((s) => s.id)).toEqual(['sf-1', 'sf-2', 'final']);
  });

  it('takes the bronze out by identity, not by id', () => {
    const final = slot('same', 3, 1);
    const bronzeSlot = slot('same', 3, 2);

    const { bronze, mainSlots } = extractBronzeMatch([final, bronzeSlot], 'single_elim');

    expect(bronze).toBe(bronzeSlot);
    expect(mainSlots).toHaveLength(1);
    expect(mainSlots[0]).toBe(final);
  });

  it('finds no bronze in a double-elimination bracket, even at position 2 of its last round', () => {
    const slots: Slot[] = [slot('r3-p1', 3, 1), slot('r4-p1', 4, 1), slot('r4-p2', 4, 2)];

    const { bronze, mainSlots } = extractBronzeMatch(slots, 'double_elim');

    expect(bronze).toBeNull();
    expect(mainSlots.map((s) => s.id)).toEqual(['r3-p1', 'r4-p1', 'r4-p2']);
  });
});
