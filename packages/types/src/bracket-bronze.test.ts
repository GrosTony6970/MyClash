import { describe, expect, it } from 'vitest';
import { extractBronzeMatch } from './bracket-bronze';

interface Slot {
  id: string;
  round: number;
  position: number;
}

function slot(id: string, round: number, position: number): Slot {
  return { id, round, position };
}

describe('extractBronzeMatch', () => {
  it('extracts the position-2 slot at the max round as the bronze match', () => {
    const slots: Slot[] = [
      slot('qf-1', 2, 0),
      slot('sf-1', 3, 0),
      slot('sf-2', 3, 1),
      slot('final-gold', 4, 0),
      slot('final-bronze', 4, 2),
    ];

    const { bronze, mainSlots } = extractBronzeMatch(slots, 'single_elim');

    expect(bronze?.id).toBe('final-bronze');
    expect(mainSlots.map((s) => s.id)).toEqual(['qf-1', 'sf-1', 'sf-2', 'final-gold']);
  });

  it('returns bronze=null and mainSlots=[] for an empty array', () => {
    const { bronze, mainSlots } = extractBronzeMatch([], 'single_elim');
    expect(bronze).toBeNull();
    expect(mainSlots).toEqual([]);
  });

  it('returns bronze=null when no slot matches position=2 at the max round', () => {
    const slots: Slot[] = [slot('sf-1', 3, 0), slot('sf-2', 3, 1), slot('final-gold', 4, 0)];

    const { bronze, mainSlots } = extractBronzeMatch(slots, 'single_elim');

    expect(bronze).toBeNull();
    expect(mainSlots).toHaveLength(3);
  });

  it('does NOT match a position-2 slot at a non-max round', () => {
    // E.g., a quarter-final at position=2 isn't a bronze — bronze
    // is by definition at the FINAL round.
    const slots: Slot[] = [slot('qf-3', 2, 2), slot('sf-1', 3, 0), slot('final-gold', 4, 0)];

    const { bronze, mainSlots } = extractBronzeMatch(slots, 'single_elim');

    expect(bronze).toBeNull();
    expect(mainSlots).toHaveLength(3);
  });

  it('finds no bronze in a double-elimination bracket, even at position 2 of its last round', () => {
    const slots: Slot[] = [slot('r3-p0', 3, 0), slot('r4-p0', 4, 0), slot('r4-p2', 4, 2)];

    const { bronze, mainSlots } = extractBronzeMatch(slots, 'double_elim');

    expect(bronze).toBeNull();
    expect(mainSlots.map((s) => s.id)).toEqual(['r3-p0', 'r4-p0', 'r4-p2']);
  });
});
