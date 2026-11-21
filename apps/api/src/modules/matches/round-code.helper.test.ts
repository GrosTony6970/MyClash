import { describe, expect, it } from 'vitest';
import { singleElimBracket } from '@myclash/rules/scheduling';
import { ROUND_CODE_EMBEDS, buildRoundCode, roundCodeFromMatchRow } from './round-code.helper';

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

const row = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  match_number_label: 'M1',
  phases: { config_json: null, tournaments: { weapon: 'sidesword' } },
  pools: null,
  bracket_slots: null,
  swiss_rounds: null,
  ...over,
});

describe('roundCodeFromMatchRow', () => {
  it('builds a pool code from the pool sort order', () => {
    expect(roundCodeFromMatchRow(row({ pools: { sort_order: 1 } }))).toBe('SDW-P2-M1');
  });

  it('builds a Swiss code from the swiss round embed', () => {
    expect(roundCodeFromMatchRow(row({ swiss_rounds: { round_number: 3 } }))).toBe('SDW-S3-M1');
  });

  it('builds a bracket code from the slot round and bracket size', () => {
    const bracket = row({
      bracket_slots: { round: 2 },
      phases: {
        config_json: { bracketSize: 8 },
        tournaments: { weapon: 'sidesword' },
      },
    });
    expect(roundCodeFromMatchRow(bracket)).toBe('SDW-B-SF-M1');
  });
});

describe('ROUND_CODE_EMBEDS', () => {
  it('names the three embeds roundCodeFromMatchRow reads', () => {
    expect(ROUND_CODE_EMBEDS).toBe(
      'pools(sort_order),bracket_slots(round),swiss_rounds(round_number)',
    );
  });
});
