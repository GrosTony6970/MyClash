import { describe, it, expect } from 'vitest';
import {
  MAX_DOUBLE_ELIM_BRACKET_SIZE,
  doubleElimBracket,
  totalDoubleElimMatches,
} from './double-elim';
import { expectRefsResolve } from './double-elim-test-helpers';

describe('doubleElimBracket', () => {
  describe('structure: 8 fighters', () => {
    const b = doubleElimBracket(8);
    // wbRounds=3, lbRounds=4, GF=round 8, no reset

    it('returns correct metadata', () => {
      expect(b.bracketSize).toBe(8);
      expect(b.fighterCount).toBe(8);
      expect(b.byeCount).toBe(0);
      expect(b.hasPlayInRound).toBe(false);
      expect(b.wbRounds).toBe(3);
      expect(b.lbRounds).toBe(4);
    });

    it('has correct slot count (WB + LB + GF)', () => {
      // WB: 4+2+1=7, LB: 2+2+1+1=6, GF: 1 → 14
      const wbSlots = b.slots.filter((s) => s.section === 'WB');
      const lbSlots = b.slots.filter((s) => s.section === 'LB');
      const gfSlots = b.slots.filter((s) => s.section === 'GF');
      expect(wbSlots.length).toBe(7);
      expect(lbSlots.length).toBe(6);
      expect(gfSlots.length).toBe(1);
    });

    /**
     * Guards against the "5 losers-bracket rounds" shape some tournament
     * write-ups describe for an 8-player draw. The correct LB is 4 rounds
     * (2, 2, 1, 1); a 5-round LB would push the total to 16 matches.
     */
    it('LB is 4 rounds of 2/2/1/1 — not 5 rounds', () => {
      const lbCounts = Array.from(
        { length: b.lbRounds },
        (_, i) =>
          b.slots.filter((s) => s.section === 'LB' && s.round === b.wbRounds + i + 1).length,
      );
      expect(lbCounts).toEqual([2, 2, 1, 1]);
      expect(b.slots.length).toBe(14);
    });

    it('WB-R1 uses seed sources', () => {
      const r1 = b.slots.filter((s) => s.round === 1);
      expect(r1.length).toBe(4);
      for (const slot of r1) {
        expect(slot.sourceAType).toBe('seed');
        expect(slot.sourceBType).toBe('seed');
        expect(slot.section).toBe('WB');
      }
    });

    it('WB-R2 uses winner_of sources pointing to WB-R1', () => {
      const r2 = b.slots.filter((s) => s.round === 2 && s.section === 'WB');
      expect(r2.length).toBe(2);
      for (const slot of r2) {
        expect(slot.sourceAType).toBe('winner_of');
        expect(slot.sourceBType).toBe('winner_of');
        expect(slot.homeSource).toMatch(/^winner of WBR1P/);
        expect(slot.awaySource).toMatch(/^winner of WBR1P/);
      }
    });

    it('LB-R1 (absolute round 4) uses loser_of WB-R1', () => {
      const lbR1 = b.slots.filter((s) => s.section === 'LB' && s.round === b.wbRounds + 1);
      expect(lbR1.length).toBe(2);
      for (const slot of lbR1) {
        expect(slot.sourceAType).toBe('loser_of');
        expect(slot.sourceBType).toBe('loser_of');
        expect(slot.homeSource).toMatch(/^loser of WBR1P/);
        expect(slot.awaySource).toMatch(/^loser of WBR1P/);
      }
    });

    it('LB-R2 (even) mixes LB survivor with WB loser', () => {
      const lbR2 = b.slots.filter((s) => s.section === 'LB' && s.round === b.wbRounds + 2);
      expect(lbR2.length).toBe(2);
      for (const slot of lbR2) {
        expect(slot.sourceAType).toBe('winner_of');
        expect(slot.sourceBType).toBe('loser_of');
        expect(slot.homeSource).toMatch(/^winner of LBR1P/);
        expect(slot.awaySource).toMatch(/^loser of WBR2P/);
      }
    });

    it('GF references WB final and LB final winners', () => {
      const gf = b.slots.find((s) => s.section === 'GF');
      expect(gf).toBeDefined();
      expect(gf!.homeSource).toBe('winner of WBR3P1');
      expect(gf!.awaySource).toBe('winner of LBR4P1');
    });

    it('no reset slot without grandFinalReset option', () => {
      const reset = b.slots.filter((s) => s.section === 'RESET');
      expect(reset.length).toBe(0);
    });
  });

  describe('grand final reset', () => {
    it('adds RESET slot when grandFinalReset=true', () => {
      const b = doubleElimBracket(8, { grandFinalReset: true });
      const reset = b.slots.filter((s) => s.section === 'RESET');
      expect(reset.length).toBe(1);
      expect(reset[0]!.sourceAType).toBe('loser_of');
      expect(reset[0]!.sourceBType).toBe('winner_of');
      expect(reset[0]!.homeSource).toBe('loser of GF');
      expect(reset[0]!.awaySource).toBe('winner of GF');
    });
  });

  describe('play-in: 5 fighters → bracket size 4', () => {
    const b = doubleElimBracket(5);

    it('trims DOWN to the lower power of two and never pads with byes', () => {
      expect(b.bracketSize).toBe(4);
      expect(b.byeCount).toBe(0);
      expect(b.playInMatchCount).toBe(1);
      expect(b.hasPlayInRound).toBe(true);
      expect(b.byeSeedCount).toBe(3);
    });

    it('round 0 pairs the lowest direct seed against the lowest qualifier', () => {
      const r0 = b.slots.filter((s) => s.round === 0);
      expect(r0.length).toBe(1);
      expect(r0[0]!.homeSource).toBe('seed 4');
      expect(r0[0]!.awaySource).toBe('seed 5');
      expect(r0[0]!.section).toBe('WB');
    });

    it('WB-R1 reads the play-in winner with a WB-prefixed ref', () => {
      const r1 = b.slots.filter((s) => s.round === 1);
      const fromPlayIn = r1
        .flatMap((s) => [s.homeSource, s.awaySource])
        .filter((r) => /R0P/.test(r));
      // The WB prefix is mandatory: buildSelfRef stamps a completed round-0
      // slot as WBR0P{n}, so a bare `winner of R0P1` would never match.
      expect(fromPlayIn).toEqual(['winner of WBR0P1']);
    });
  });

  describe('play-in: 12 fighters → bracket size 8', () => {
    const b = doubleElimBracket(12);

    it('has 4 play-in matches feeding a full 8-fighter WB', () => {
      expect(b.bracketSize).toBe(8);
      expect(b.playInMatchCount).toBe(4);
      expect(b.byeSeedCount).toBe(4);
      expect(b.byeCount).toBe(0);
    });

    /**
     * The regression this whole slice exists for. Before the play-in model,
     * a 12-fighter field padded to 16 with 4 byes, and all 4 LB-R1 slots
     * referenced `loser of WBR1Px` where Px was a bye — a permanent stall.
     */
    it('no LB slot depends on a match that will never be played', () => {
      const wbR1Refs = new Set(
        b.slots.filter((s) => s.round === 1).map((s) => `WBR1P${s.position}`),
      );
      const lbR1 = b.slots.filter((s) => s.section === 'LB' && s.round === b.wbRounds + 1);
      expect(lbR1.length).toBeGreaterThan(0);
      for (const slot of lbR1) {
        for (const ref of [slot.homeSource, slot.awaySource]) {
          expect(wbR1Refs).toContain(/^loser of (.+)$/.exec(ref)![1]!);
        }
      }
    });
  });

  describe('32-fighter double elim structure', () => {
    const b = doubleElimBracket(32);

    it('returns correct metadata', () => {
      expect(b.bracketSize).toBe(32);
      expect(b.fighterCount).toBe(32);
      expect(b.byeCount).toBe(0);
      expect(b.wbRounds).toBe(5);
      expect(b.lbRounds).toBe(8);
    });

    it('WB has correct slot counts per round', () => {
      // R1: 16, R2: 8, R3: 4, R4: 2, R5: 1 → total 31
      const wbSlots = b.slots.filter((s) => s.section === 'WB');
      expect(wbSlots.length).toBe(31);
    });

    it('LB has correct total slots', () => {
      // LB-R1: 8, R2: 8, R3: 4, R4: 4, R5: 2, R6: 2, R7: 1, R8: 1 → total 30
      const lbSlots = b.slots.filter((s) => s.section === 'LB');
      expect(lbSlots.length).toBe(30);
    });

    it('GF references WB-R5 and LB-R8 winners', () => {
      const gf = b.slots.find((s) => s.section === 'GF');
      expect(gf!.homeSource).toBe('winner of WBR5P1');
      expect(gf!.awaySource).toBe('winner of LBR8P1');
    });

    it('LB-R2 WB drop round is R2 (k=2 → wbDropRound = k/2+1 = 2)', () => {
      const lbR2Abs = b.wbRounds + 2;
      const lbR2 = b.slots.filter((s) => s.section === 'LB' && s.round === lbR2Abs);
      for (const slot of lbR2) {
        expect(slot.awaySource).toMatch(/^loser of WBR2P/);
      }
    });

    it('LB-R4 WB drop round is R3', () => {
      const lbR4Abs = b.wbRounds + 4;
      const lbR4 = b.slots.filter((s) => s.section === 'LB' && s.round === lbR4Abs);
      for (const slot of lbR4) {
        expect(slot.awaySource).toMatch(/^loser of WBR3P/);
      }
    });

    it('odd LB rounds are consolidation (winner_of on both sides)', () => {
      // k=3 (odd, ≥3) is a consolidation round
      const lbR3Abs = b.wbRounds + 3;
      const lbR3 = b.slots.filter((s) => s.section === 'LB' && s.round === lbR3Abs);
      for (const slot of lbR3) {
        expect(slot.sourceAType).toBe('winner_of');
        expect(slot.sourceBType).toBe('winner_of');
      }
    });
  });

  describe('two fighters (no losers bracket at all)', () => {
    const b = doubleElimBracket(2, { grandFinalReset: true });

    it('has zero LB rounds and reads the second chance off the WB final', () => {
      expect(b.wbRounds).toBe(1);
      expect(b.lbRounds).toBe(0);
      const gf = b.slots.find((s) => s.section === 'GF')!;
      // `winner of LBR0P1` would name a slot that does not exist.
      expect(gf.awaySource).toBe('loser of WBR1P1');
      expect(gf.sourceBType).toBe('loser_of');
    });

    it('still resolves every ref', () => {
      expectRefsResolve(b);
    });
  });

  describe('invariants across every field size', () => {
    const sizes = Array.from({ length: 63 }, (_, i) => i + 2); // 2..64

    it('every advancement ref resolves to a real slot', () => {
      for (const n of sizes) {
        expectRefsResolve(doubleElimBracket(n));
        expectRefsResolve(doubleElimBracket(n, { grandFinalReset: true }));
      }
    });

    it('never emits a bye', () => {
      for (const n of sizes) {
        const b = doubleElimBracket(n);
        expect(b.byeCount).toBe(0);
        for (const slot of b.slots) {
          expect(slot.isBye).toBe(false);
          expect(slot.sourceAType).not.toBe('bye');
          expect(slot.sourceBType).not.toBe('bye');
        }
      }
    });

    it('every seed 1..N is placed exactly once', () => {
      for (const n of sizes) {
        const b = doubleElimBracket(n);
        const seeds = b.slots
          .flatMap((s) => [s.homeSource, s.awaySource])
          .map((ref) => /^seed (\d+)$/.exec(ref))
          .filter((m): m is RegExpExecArray => m !== null)
          .map((m) => Number(m[1]));
        expect(seeds.slice().sort((a, c) => a - c)).toEqual(
          Array.from({ length: n }, (_, i) => i + 1),
        );
      }
    });

    it('slot count matches totalDoubleElimMatches', () => {
      for (const n of sizes) {
        expect(doubleElimBracket(n).slots.length).toBe(totalDoubleElimMatches(n));
        expect(doubleElimBracket(n, { grandFinalReset: true }).slots.length).toBe(
          totalDoubleElimMatches(n, { grandFinalReset: true }),
        );
      }
    });

    it('main bracket is 2*bracketSize-2 matches, play-ins are additive', () => {
      // Play-in losers exit after ONE loss, so the 2N-2 rule applies to the
      // main bracket only — 12 fighters is 4 + 14, not 22.
      expect(totalDoubleElimMatches(8)).toBe(14);
      expect(totalDoubleElimMatches(8, { grandFinalReset: true })).toBe(15);
      expect(totalDoubleElimMatches(12)).toBe(18);
      expect(totalDoubleElimMatches(5)).toBe(7);
    });
  });

  describe('error cases', () => {
    it('throws for fewer than 2 fighters', () => {
      expect(() => doubleElimBracket(1)).toThrow();
    });

    it('throws for non-power-of-2 bracketSize', () => {
      expect(() => doubleElimBracket(8, { bracketSize: 6 })).toThrow('power of 2');
    });

    it('refuses a bracket larger than the field — that means byes', () => {
      expect(() => doubleElimBracket(5, { bracketSize: 8 })).toThrow('full bracket');
    });

    it('refuses a field the play-in round cannot absorb', () => {
      // 20 fighters into a bracket of 8 would need 12 play-in matches for 8 seats.
      expect(() => doubleElimBracket(20, { bracketSize: 8 })).toThrow('2 x bracketSize');
    });

    it('allows cutting down to a smaller bracket via the play-in', () => {
      const b = doubleElimBracket(10, { bracketSize: 8 });
      expect(b.bracketSize).toBe(8);
      expect(b.playInMatchCount).toBe(2);
      expectRefsResolve(b);
    });

    it('caps bracket size at 128', () => {
      expect(() => doubleElimBracket(MAX_DOUBLE_ELIM_BRACKET_SIZE * 2)).toThrow('128');
      expect(() => doubleElimBracket(256, { bracketSize: 256 })).toThrow('128');
    });

    it('absorbs a field just over the cap with a play-in rather than throwing', () => {
      const b = doubleElimBracket(MAX_DOUBLE_ELIM_BRACKET_SIZE + 1);
      expect(b.bracketSize).toBe(MAX_DOUBLE_ELIM_BRACKET_SIZE);
      expect(b.playInMatchCount).toBe(1);
    });
  });
});
