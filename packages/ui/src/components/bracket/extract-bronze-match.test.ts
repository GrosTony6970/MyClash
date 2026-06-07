import { describe, expect, it } from 'vitest';
import { extractBronzeMatch } from './extract-bronze-match';
import type { BracketSlotData } from './types';

function slot(overrides: Partial<BracketSlotData>): BracketSlotData {
  return {
    id: 's',
    round: 1,
    position: 0,
    redFighterName: null,
    blueFighterName: null,
    redScore: null,
    blueScore: null,
    status: 'pending',
    matchId: null,
    ...overrides,
  };
}

describe('extractBronzeMatch', () => {
  it('extracts the position-2 slot at the max round as the bronze match', () => {
    const slots: BracketSlotData[] = [
      slot({ id: 'qf-1', round: 2, position: 0 }),
      slot({ id: 'sf-1', round: 3, position: 0 }),
      slot({ id: 'sf-2', round: 3, position: 1 }),
      slot({ id: 'final-gold', round: 4, position: 0 }),
      slot({ id: 'final-bronze', round: 4, position: 2 }),
    ];

    const { bronze, mainSlots } = extractBronzeMatch(slots);

    expect(bronze?.id).toBe('final-bronze');
    expect(mainSlots.map((s) => s.id)).toEqual(['qf-1', 'sf-1', 'sf-2', 'final-gold']);
  });

  it('returns bronze=null and mainSlots=[] for an empty array', () => {
    const { bronze, mainSlots } = extractBronzeMatch([]);
    expect(bronze).toBeNull();
    expect(mainSlots).toEqual([]);
  });

  it('returns bronze=null when no slot matches position=2 at the max round', () => {
    const slots: BracketSlotData[] = [
      slot({ id: 'sf-1', round: 3, position: 0 }),
      slot({ id: 'sf-2', round: 3, position: 1 }),
      slot({ id: 'final-gold', round: 4, position: 0 }),
    ];

    const { bronze, mainSlots } = extractBronzeMatch(slots);

    expect(bronze).toBeNull();
    expect(mainSlots).toHaveLength(3);
  });

  it('does NOT match a position-2 slot at a non-max round', () => {
    // E.g., a quarter-final at position=2 isn't a bronze — bronze
    // is by definition at the FINAL round.
    const slots: BracketSlotData[] = [
      slot({ id: 'qf-3', round: 2, position: 2 }),
      slot({ id: 'sf-1', round: 3, position: 0 }),
      slot({ id: 'final-gold', round: 4, position: 0 }),
    ];

    const { bronze, mainSlots } = extractBronzeMatch(slots);

    expect(bronze).toBeNull();
    expect(mainSlots).toHaveLength(3);
  });
});
