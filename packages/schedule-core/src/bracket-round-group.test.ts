import { describe, expect, it } from 'vitest';
import { parseBracketRound } from './bracket-round-group';

describe('parseBracketRound', () => {
  it('labels a play-in code as "Play-ins"', () => {
    expect(parseBracketRound('LSW-B-PI-M5')?.label).toBe('Play-ins');
  });

  it('labels QF/SF/F by their named rounds', () => {
    expect(parseBracketRound('LSW-B-QF-M1')?.label).toBe('Quarter-finals');
    expect(parseBracketRound('LSW-B-SF-M1')?.label).toBe('Semi-finals');
    expect(parseBracketRound('LSW-B-F-M1')?.label).toBe('Final');
  });

  it('labels R<k> rounds as "Round of <k>"', () => {
    expect(parseBracketRound('LSW-B-R16-M1')?.label).toBe('Round of 16');
    expect(parseBracketRound('LSW-B-R32-M1')?.label).toBe('Round of 32');
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

  it('falls back to "Round <n>" for the B<n> token (double-elim / unknown size)', () => {
    const r = parseBracketRound('LSW-B-B4-M1');
    expect(r?.label).toBe('Round 4');
    // Fallback rounds sort after the named single-elim rounds.
    expect(r!.order).toBeGreaterThan(parseBracketRound('LSW-B-F-M1')!.order);
  });
});

describe('parseBracketRound — Swiss', () => {
  it('labels an S<n> code as "Swiss Round n"', () => {
    expect(parseBracketRound('LSW-S1-M1')?.label).toBe('Swiss Round 1');
    expect(parseBracketRound('LSW-S5-M12')?.label).toBe('Swiss Round 5');
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
    expect(parseBracketRound('SBR-B-QF-M1')?.label).toBe('Quarter-finals');
    expect(parseBracketRound('SBR-P1-M3')).toBeNull();
  });
});

describe('parseBracketRound — double elimination', () => {
  const parse = (token: string) => parseBracketRound(`LSW-B-${token}-M1`);

  it('labels winners, losers and grand-final rounds distinctly', () => {
    expect(parse('WBF')?.label).toBe('Winners Final');
    expect(parse('WBSF')?.label).toBe('Winners Semi-finals');
    expect(parse('WBR16')?.label).toBe('Winners Round of 16');
    expect(parse('LB3')?.label).toBe('Losers Round 3');
    expect(parse('GF')?.label).toBe('Grand Final');
    expect(parse('GFR')?.label).toBe('Grand Final Reset');
  });

  it('orders play-ins → winners → losers → grand final', () => {
    const order = ['PI', 'WBR16', 'WBQF', 'WBSF', 'WBF', 'LB1', 'LB4', 'GF', 'GFR'].map(
      (tok) => parse(tok)!.order,
    );
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(new Set(order).size).toBe(order.length);
  });
});
