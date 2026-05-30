import { describe, expect, it } from 'vitest';
import { singleElimBracket } from '@myclash/rulesets/dist/scheduling/index';
import { buildRoundCode } from './round-code.helper';

// ── Round-code shape (regression for the position-off-by-one bug) ────────────
//
// User reported: a 16-fighter bracket renders R16 cards labeled
// LSW-R16-M2…M9 (eight cards but numbered as if there were nine, leaving
// M1 forever empty and M9 looking orphaned). Root cause was the display
// layer adding `+ 1` to `bracket_slots.position`, which is ALREADY 1-indexed
// in the generator. This test pins the canonical mapping so future display
// callers can't slip the same off-by-one back in: the formatter must
// receive `slot.position` as-is, NOT `slot.position + 1`.

function codeForSlot(slot: { round: number; position: number }, bracketSize: number): string {
  return buildRoundCode({
    weapon: 'longsword',
    poolNumber: null,
    bracketRound: slot.round,
    bracketSize,
    matchNumberLabel: String(slot.position),
    roundNumber: null,
  });
}

describe('buildRoundCode against singleElimBracket output', () => {
  it('16 fighters: R16 M1..M8, QF M1..M4, SF M1..M2, F M1, bronze F M2 (with B segment)', () => {
    const bracket = singleElimBracket(16);

    // R16 = round 1, eight slots at positions 1..8.
    expect(
      bracket.slots.filter((s) => s.round === 1).map((s) => codeForSlot(s, bracket.bracketSize)),
    ).toEqual([
      'LSW-B-R16-M1',
      'LSW-B-R16-M2',
      'LSW-B-R16-M3',
      'LSW-B-R16-M4',
      'LSW-B-R16-M5',
      'LSW-B-R16-M6',
      'LSW-B-R16-M7',
      'LSW-B-R16-M8',
    ]);

    expect(
      bracket.slots.filter((s) => s.round === 2).map((s) => codeForSlot(s, bracket.bracketSize)),
    ).toEqual(['LSW-B-QF-M1', 'LSW-B-QF-M2', 'LSW-B-QF-M3', 'LSW-B-QF-M4']);

    expect(
      bracket.slots.filter((s) => s.round === 3).map((s) => codeForSlot(s, bracket.bracketSize)),
    ).toEqual(['LSW-B-SF-M1', 'LSW-B-SF-M2']);

    // Round 4: final at position 1 + bronze at position 2.
    expect(
      bracket.slots.filter((s) => s.round === 4).map((s) => codeForSlot(s, bracket.bracketSize)),
    ).toEqual(['LSW-B-F-M1', 'LSW-B-F-M2']);

    // Sanity: no slot ends in -M9 (the "orphan" from the bug report).
    const codes = bracket.slots.map((s) => codeForSlot(s, bracket.bracketSize));
    expect(codes.some((c) => c.endsWith('-M9'))).toBe(false);
  });

  it('32 fighters: every round starts at M1, never M2 (with B segment)', () => {
    const bracket = singleElimBracket(32);
    const firstCodeByRound = new Map<number, string>();
    for (const slot of bracket.slots) {
      if (slot.position === 1 && !firstCodeByRound.has(slot.round)) {
        firstCodeByRound.set(slot.round, codeForSlot(slot, bracket.bracketSize));
      }
    }
    expect(firstCodeByRound.get(1)).toBe('LSW-B-R32-M1');
    expect(firstCodeByRound.get(2)).toBe('LSW-B-R16-M1');
    expect(firstCodeByRound.get(3)).toBe('LSW-B-QF-M1');
    expect(firstCodeByRound.get(4)).toBe('LSW-B-SF-M1');
    expect(firstCodeByRound.get(5)).toBe('LSW-B-F-M1');
  });
});
