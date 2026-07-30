import { describe, expect, it } from 'vitest';
import { accentClassFor, tintBgClassFor, tintTextClassFor, type ColorToken } from '@myclash/ui';

describe('accentClassFor', () => {
  const cases: Array<[ColorToken, string]> = [
    ['red', 'bg-red-700'],
    ['blue', 'bg-blue-700'],
    ['green', 'bg-green-700'],
    ['yellow', 'bg-yellow-400'],
    ['purple', 'bg-purple-700'],
    ['orange', 'bg-orange-600'],
    ['black', 'bg-slate-900'],
    ['white', 'bg-slate-100'],
    ['amber', 'bg-amber-600'],
    ['violet', 'bg-violet-700'],
    ['teal', 'bg-teal-700'],
    ['gold', 'bg-amber-400'],
    ['silver', 'bg-slate-300'],
    ['bronze', 'bg-amber-700'],
    ['slate', 'bg-slate-400'],
  ];

  it.each(cases)('maps token %s to %s', (token, expected) => {
    expect(accentClassFor(token)).toBe(expected);
  });

  // Neutral, not red. These helpers also paint bracket fighter sides, so a red
  // fallback painted BOTH fighters red whenever a side colour failed to load.
  it('falls back to neutral slate for an unknown token', () => {
    expect(accentClassFor('unknown' as ColorToken)).toBe('bg-slate-400');
  });

  it('falls back to neutral slate for null and undefined', () => {
    expect(accentClassFor(null)).toBe('bg-slate-400');
    expect(accentClassFor(undefined)).toBe('bg-slate-400');
  });
});

describe('tintBgClassFor', () => {
  it('returns the soft tint for known tokens', () => {
    expect(tintBgClassFor('red')).toBe('bg-red-50');
    expect(tintBgClassFor('gold')).toBe('bg-amber-100');
    expect(tintBgClassFor('slate')).toBe('bg-slate-50');
  });

  it('falls back to the neutral slate tint for unknown tokens', () => {
    expect(tintBgClassFor('unknown')).toBe('bg-slate-50');
  });
});

describe('tintTextClassFor', () => {
  it('returns the paired text color for known tokens', () => {
    expect(tintTextClassFor('blue')).toBe('text-blue-700');
    expect(tintTextClassFor('gold')).toBe('text-amber-900');
    expect(tintTextClassFor('silver')).toBe('text-slate-700');
  });
});
