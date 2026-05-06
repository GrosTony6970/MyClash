import { describe, it, expect } from 'vitest';
import { doubleElimBracket } from './double-elim';

describe('doubleElimBracket', () => {
  describe('structure: 8 fighters', () => {
    const b = doubleElimBracket(8);
    // wbRounds=3, lbRounds=4, GF=round 8, no reset

    it('returns correct metadata', () => {
      expect(b.bracketSize).toBe(8);
      expect(b.fighterCount).toBe(8);
      expect(b.byeCount).toBe(0);
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

  describe('bye handling: 5 fighters → bracket size 8', () => {
    const b = doubleElimBracket(5);

    it('has 3 byes', () => {
      expect(b.byeCount).toBe(3);
    });

    it('bye WB-R1 slots have null seeds and bye source types', () => {
      const byeSlots = b.slots.filter((s) => s.round === 1 && s.isBye);
      expect(byeSlots.length).toBe(3);
      for (const slot of byeSlots) {
        const hasByeA = slot.sourceAType === 'bye';
        const hasByeB = slot.sourceBType === 'bye';
        expect(hasByeA || hasByeB).toBe(true);
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

  describe('error cases', () => {
    it('throws for fewer than 2 fighters', () => {
      expect(() => doubleElimBracket(1)).toThrow();
    });

    it('throws for non-power-of-2 bracketSize', () => {
      expect(() => doubleElimBracket(8, { bracketSize: 6 })).toThrow();
    });

    it('throws if bracketSize < fighterCount', () => {
      expect(() => doubleElimBracket(10, { bracketSize: 8 })).toThrow();
    });
  });
});
