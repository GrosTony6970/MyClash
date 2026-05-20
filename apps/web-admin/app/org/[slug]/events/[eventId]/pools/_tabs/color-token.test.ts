import { describe, expect, it } from 'vitest';
import { accentClassFor, type ColorToken } from './color-token';

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
  ];

  it.each(cases)('maps token %s to %s', (token, expected) => {
    expect(accentClassFor(token)).toBe(expected);
  });

  it('falls back to red-700 for an unknown token', () => {
    expect(accentClassFor('unknown' as ColorToken)).toBe('bg-red-700');
  });
});
