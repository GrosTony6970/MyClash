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
