/**
 * Single-elimination bracket tests.
 * Verified against standard tournament bracket conventions.
 */
import { describe, it, expect } from 'vitest';
import { singleElimBracket, totalBracketMatches } from './single-elim';

// ── totalBracketMatches ───────────────────────────────────────────────────────

describe('totalBracketMatches', () => {
  it('always N-1 matches (every match eliminates one fighter)', () => {
    expect(totalBracketMatches(2)).toBe(1);
    expect(totalBracketMatches(4)).toBe(3);
    expect(totalBracketMatches(8)).toBe(7);
    expect(totalBracketMatches(16)).toBe(15);
    expect(totalBracketMatches(13)).toBe(12);
  });
});

// ── singleElimBracket ─────────────────────────────────────────────────────────

describe('singleElimBracket', () => {

  // ── KEY AC TEST: 16 fighters → 4 rounds, 15 matches ──────────────────────
  it('16 fighters → 4 rounds, 15 matches, 0 byes', () => {
    const bracket = singleElimBracket(16);
    expect(bracket.bracketSize).toBe(16);
    expect(bracket.fighterCount).toBe(16);
    expect(bracket.byeCount).toBe(0);
    expect(bracket.rounds).toBe(4);
    expect(bracket.slots).toHaveLength(15); // 8+4+2+1
  });

  // ── KEY AC TEST: 13 fighters → 3 byes in round 1 ─────────────────────────
  it('13 fighters → bracket size 16, 3 byes', () => {
    const bracket = singleElimBracket(13);
    expect(bracket.bracketSize).toBe(16);
    expect(bracket.byeCount).toBe(3);
    expect(bracket.rounds).toBe(4);

    const r1Byes = bracket.slots.filter((s) => s.round === 1 && s.isBye);
    expect(r1Byes).toHaveLength(3);
  });

  it('13 fighters → 12 total matches (N-1)', () => {
    const bracket = singleElimBracket(13);
    expect(bracket.slots).toHaveLength(15); // bracket slots = bracketSize-1
    // But only 12 are real matches (3 are byes in R1)
    expect(totalBracketMatches(13)).toBe(12);
  });

  // ── KEY AC TEST: seed 1 vs seed 16, seed 8 vs seed 9 ─────────────────────
  it('16 fighters: seed 1 vs seed 16 in round 1', () => {
    const bracket = singleElimBracket(16);
    const r1 = bracket.slots.filter((s) => s.round === 1);
    const match1v16 = r1.find(
      (s) =>
        (s.homeSeed === 1 && s.awaySeed === 16) ||
        (s.homeSeed === 16 && s.awaySeed === 1),
    );
    expect(match1v16).toBeDefined();
  });

  it('16 fighters: seed 8 vs seed 9 in round 1', () => {
    const bracket = singleElimBracket(16);
    const r1 = bracket.slots.filter((s) => s.round === 1);
    const match8v9 = r1.find(
      (s) =>
        (s.homeSeed === 8 && s.awaySeed === 9) ||
        (s.homeSeed === 9 && s.awaySeed === 8),
    );
    expect(match8v9).toBeDefined();
  });

  it('16 fighters: seed 1 and seed 2 are in opposite halves', () => {
    const bracket = singleElimBracket(16);
    const r1 = bracket.slots.filter((s) => s.round === 1);
    const pos1 = r1.findIndex((s) => s.homeSeed === 1 || s.awaySeed === 1);
    const pos2 = r1.findIndex((s) => s.homeSeed === 2 || s.awaySeed === 2);
    // In a 16-bracket, positions 1-4 are top half, 5-8 are bottom half
    const topHalf = (pos: number) => pos < 4;
    expect(topHalf(pos1)).not.toBe(topHalf(pos2));
  });

  // ── Bye placement ─────────────────────────────────────────────────────────
  it('byes protect top seeds (seed 1 gets a bye when byes exist)', () => {
    const bracket = singleElimBracket(13); // 3 byes
    const r1 = bracket.slots.filter((s) => s.round === 1);
    const seed1Match = r1.find((s) => s.homeSeed === 1 || s.awaySeed === 1);
    expect(seed1Match?.isBye).toBe(true);
  });

  it('byes protect top seeds (seed 2 gets a bye when byes exist)', () => {
    const bracket = singleElimBracket(13); // 3 byes
    const r1 = bracket.slots.filter((s) => s.round === 1);
    const seed2Match = r1.find((s) => s.homeSeed === 2 || s.awaySeed === 2);
    expect(seed2Match?.isBye).toBe(true);
  });

  // ── Round structure ───────────────────────────────────────────────────────
  it('8 fighters → 3 rounds, 7 slots', () => {
    const bracket = singleElimBracket(8);
    expect(bracket.rounds).toBe(3);
    expect(bracket.slots).toHaveLength(7); // 4+2+1
    expect(bracket.byeCount).toBe(0);
  });

  it('4 fighters → 2 rounds, 3 slots', () => {
    const bracket = singleElimBracket(4);
    expect(bracket.rounds).toBe(2);
    expect(bracket.slots).toHaveLength(3); // 2+1
  });

  it('2 fighters → 1 round, 1 slot (the final)', () => {
    const bracket = singleElimBracket(2);
    expect(bracket.rounds).toBe(1);
    expect(bracket.slots).toHaveLength(1);
    expect(bracket.slots[0]?.homeSeed).toBe(1);
    expect(bracket.slots[0]?.awaySeed).toBe(2);
  });

  // ── Non-power-of-2 ────────────────────────────────────────────────────────
  it('5 fighters → bracket size 8, 3 byes', () => {
    const bracket = singleElimBracket(5);
    expect(bracket.bracketSize).toBe(8);
    expect(bracket.byeCount).toBe(3);
    expect(bracket.rounds).toBe(3);
  });

  it('6 fighters → bracket size 8, 2 byes', () => {
    const bracket = singleElimBracket(6);
    expect(bracket.bracketSize).toBe(8);
    expect(bracket.byeCount).toBe(2);
  });

  // ── Source labels ─────────────────────────────────────────────────────────
  it('round 2+ slots have winner-of source labels', () => {
    const bracket = singleElimBracket(8);
    const r2 = bracket.slots.filter((s) => s.round === 2);
    for (const slot of r2) {
      expect(slot.homeSource).toMatch(/^winner of R1P\d+$/);
      expect(slot.awaySource).toMatch(/^winner of R1P\d+$/);
    }
  });

  // ── Error handling ────────────────────────────────────────────────────────
  it('throws for fewer than 2 fighters', () => {
    expect(() => singleElimBracket(1)).toThrow();
    expect(() => singleElimBracket(0)).toThrow();
  });

  // ── Configurable bracket size ─────────────────────────────────────────────
  it('bracketSize=16 with 13 fighters → 3 byes (same as default)', () => {
    const bracket = singleElimBracket(13, { bracketSize: 16 });
    expect(bracket.bracketSize).toBe(16);
    expect(bracket.byeCount).toBe(3);
  });

  it('bracketSize=32 with 24 fighters → 8 byes (larger bracket)', () => {
    const bracket = singleElimBracket(24, { bracketSize: 32 });
    expect(bracket.bracketSize).toBe(32);
    expect(bracket.byeCount).toBe(8);
    expect(bracket.rounds).toBe(5);
  });

  it('bracketSize=16 with 20 fighters → cut to top 16 (error: bracketSize < fighterCount)', () => {
    // To cut to top 16, the caller passes fighterCount=16 (already filtered)
    // bracketSize < fighterCount is an error
    expect(() => singleElimBracket(20, { bracketSize: 16 })).toThrow('bracketSize');
  });

  it('bracketSize must be a power of 2', () => {
    expect(() => singleElimBracket(8, { bracketSize: 12 })).toThrow('power of 2');
  });

  it('bracketSize=8 with 8 fighters → 0 byes (explicit = default)', () => {
    const bracket = singleElimBracket(8, { bracketSize: 8 });
    expect(bracket.bracketSize).toBe(8);
    expect(bracket.byeCount).toBe(0);
  });

  // ── All seeds appear exactly once in round 1 ──────────────────────────────
  it('all seeds 1..N appear exactly once in round 1', () => {
    const n = 16;
    const bracket = singleElimBracket(n);
    const r1 = bracket.slots.filter((s) => s.round === 1);
    const seeds = new Set<number>();
    for (const slot of r1) {
      if (slot.homeSeed !== null) seeds.add(slot.homeSeed);
      if (slot.awaySeed !== null) seeds.add(slot.awaySeed);
    }
    for (let i = 1; i <= n; i++) {
      expect(seeds.has(i)).toBe(true);
    }
    expect(seeds.size).toBe(n);
  });
});
