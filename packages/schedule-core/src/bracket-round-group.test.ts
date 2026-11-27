import { describe, expect, it } from 'vitest';
import { parseBracketRound } from './bracket-round-group';

describe('parseBracketRound', () => {
  it('reads a play-in code as PI', () => {
    expect(parseBracketRound('LSW-B-PI-M5')?.token).toBe('PI');
  });

  it('reads QF/SF/F as their named rounds', () => {
    expect(parseBracketRound('LSW-B-QF-M1')?.token).toBe('QF');
    expect(parseBracketRound('LSW-B-SF-M1')?.token).toBe('SF');
    expect(parseBracketRound('LSW-B-F-M1')?.token).toBe('F');
  });

  it('reads R<k> rounds', () => {
    expect(parseBracketRound('LSW-B-R16-M1')?.token).toBe('R16');
    expect(parseBracketRound('LSW-B-R32-M1')?.token).toBe('R32');
  });

  it('returns null for pool codes and missing codes', () => {
    expect(parseBracketRound('LSW-P1-M3')).toBeNull();
    expect(parseBracketRound(undefined)).toBeNull();
    expect(parseBracketRound(null)).toBeNull();
  });

  it('orders rounds play-ins → R32 → R16 → QF → SF → Final', () => {
    const codes = [
      'LSW-B-F-M1',
      'LSW-B-R16-M1',
      'LSW-B-PI-M1',
      'LSW-B-SF-M1',
      'LSW-B-R32-M1',
      'LSW-B-QF-M1',
    ];
    const ordered = codes
      .map((c) => parseBracketRound(c)!)
      .sort((a, b) => a.order - b.order)
      .map((r) => r.token);
    expect(ordered).toEqual(['PI', 'R32', 'R16', 'QF', 'SF', 'F']);
  });

  it('reads the B<n> fallback token (double-elim / unknown size)', () => {
    const r = parseBracketRound('LSW-B-B4-M1');
    expect(r?.token).toBe('B4');
    // Fallback rounds sort after the named single-elim rounds.
    expect(r!.order).toBeGreaterThan(parseBracketRound('LSW-B-F-M1')!.order);
  });
});

describe('parseBracketRound — Swiss', () => {
  it('reads an S<n> code as its Swiss round', () => {
    expect(parseBracketRound('LSW-S1-M1')?.token).toBe('S1');
    expect(parseBracketRound('LSW-S5-M12')?.token).toBe('S5');
  });

  it('keeps the S<n> token so the group key is per round, not per phase', () => {
    expect(parseBracketRound('LSW-S3-M2')?.token).toBe('S3');
    expect(parseBracketRound('LSW-S3-M2')?.token).not.toBe(parseBracketRound('LSW-S4-M2')?.token);
  });

  it('orders Swiss rounds ascending and all of them before play-ins', () => {
    const s1 = parseBracketRound('LSW-S1-M1')!.order;
    const s9 = parseBracketRound('LSW-S9-M1')!.order;
    const playIns = parseBracketRound('LSW-B-PI-M1')!.order;
    expect(s1).toBeLessThan(s9);
    // A Swiss phase feeding a bracket must read Swiss Round 1…N, then Play-ins.
    expect(s9).toBeLessThan(playIns);
  });

  it('still returns null for pool codes, which also carry a middle segment', () => {
    expect(parseBracketRound('LSW-P1-M3')).toBeNull();
    expect(parseBracketRound('SB-P12-M3')).toBeNull();
  });

  it('does not mistake a weapon abbreviation or match number for a round', () => {
    // weaponAbbr strips digits, so no abbreviation can match /^S\d+$/ —
    // "Sabre" is SBR and a hypothetical S-weapon is still letters-only.
    expect(parseBracketRound('SBR-B-QF-M1')?.token).toBe('QF');
    expect(parseBracketRound('SBR-P1-M3')).toBeNull();
  });
});

describe('parseBracketRound — double elimination', () => {
  const parse = (token: string) => parseBracketRound(`LSW-B-${token}-M1`);

  it('reads winners, losers and grand-final rounds distinctly', () => {
    for (const token of ['WBF', 'WBSF', 'WBR16', 'LB3', 'GF', 'GFR']) {
      expect(parse(token)?.token).toBe(token);
    }
  });

  it('orders play-ins → winners → losers → grand final', () => {
    const order = ['PI', 'WBR16', 'WBQF', 'WBSF', 'WBF', 'LB1', 'LB4', 'GF', 'GFR'].map(
      (tok) => parse(tok)!.order,
    );
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(new Set(order).size).toBe(order.length);
  });
});
