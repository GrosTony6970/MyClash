import { describe, it, expect } from 'vitest';
import { naturalCompare } from './pool-matches-sort';

describe('naturalCompare', () => {
  it('orders embedded numbers numerically, not lexicographically', () => {
    const codes = [
      'LSW-P1-ML1-PA-M1',
      'LSW-P1-ML1-PA-M10',
      'LSW-P1-ML1-PA-M2',
      'LSW-P1-ML1-PA-M28',
      'LSW-P1-ML1-PA-M3',
    ];
    const sorted = [...codes].sort(naturalCompare);
    expect(sorted).toEqual([
      'LSW-P1-ML1-PA-M1',
      'LSW-P1-ML1-PA-M2',
      'LSW-P1-ML1-PA-M3',
      'LSW-P1-ML1-PA-M10',
      'LSW-P1-ML1-PA-M28',
    ]);
  });

  it('returns 0 for equal strings and is stable on identical prefixes', () => {
    expect(naturalCompare('M5', 'M5')).toBe(0);
    expect(naturalCompare('A', 'A')).toBe(0);
  });

  it('compares earlier numeric segments before later ones', () => {
    // Pool number dominates the match number.
    const codes = ['LSW-P2-ML1-PA-M1', 'LSW-P1-ML1-PA-M9'];
    expect([...codes].sort(naturalCompare)).toEqual(['LSW-P1-ML1-PA-M9', 'LSW-P2-ML1-PA-M1']);
  });
});
