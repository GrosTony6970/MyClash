import { describe, expect, it } from 'vitest';
import { formatLocalizedDate, getDateFormat, parseLocalizedDate } from './date';

describe('date helpers — fr', () => {
  it('round-trips 15/03/1990 ↔ 1990-03-15', () => {
    expect(parseLocalizedDate('15/03/1990', 'fr')).toBe('1990-03-15');
    expect(formatLocalizedDate('1990-03-15', 'fr')).toBe('15/03/1990');
  });

  it('rejects impossible 31/02/2000 (round-trip via Date)', () => {
    expect(parseLocalizedDate('31/02/2000', 'fr')).toBeNull();
  });

  it('returns null for empty / undefined / whitespace input', () => {
    expect(parseLocalizedDate('', 'fr')).toBeNull();
    expect(parseLocalizedDate('   ', 'fr')).toBeNull();
    expect(parseLocalizedDate(null, 'fr')).toBeNull();
    expect(parseLocalizedDate(undefined, 'fr')).toBeNull();
  });

  it('rejects ISO-shaped input under fr (strict to format)', () => {
    expect(parseLocalizedDate('1990-03-15', 'fr')).toBeNull();
  });

  it('rejects truncated input 13/05', () => {
    expect(parseLocalizedDate('13/05', 'fr')).toBeNull();
  });
});

describe('date helpers — en', () => {
  it('round-trips 03/15/1990 ↔ 1990-03-15', () => {
    expect(parseLocalizedDate('03/15/1990', 'en')).toBe('1990-03-15');
    expect(formatLocalizedDate('1990-03-15', 'en')).toBe('03/15/1990');
  });

  it('rejects impossible 02/31/2000', () => {
    expect(parseLocalizedDate('02/31/2000', 'en')).toBeNull();
  });

  it('rejects 03/15/1990 input under fr (locale-strict)', () => {
    // 15 is not a valid month → impossible date catches it.
    expect(parseLocalizedDate('03/15/1990', 'fr')).toBeNull();
  });

  it('exposes placeholder + htmlPattern via getDateFormat', () => {
    const fr = getDateFormat('fr');
    expect(fr.placeholder).toBe('JJ/MM/AAAA');
    expect(fr.htmlPattern).toBe('\\d{2}/\\d{2}/\\d{4}');
    const en = getDateFormat('en');
    expect(en.placeholder).toBe('MM/DD/YYYY');
    expect(en.htmlPattern).toBe('\\d{2}/\\d{2}/\\d{4}');
  });
});

describe('date helpers — edge cases', () => {
  it('formatLocalizedDate returns empty string for empty/malformed ISO', () => {
    expect(formatLocalizedDate('', 'fr')).toBe('');
    expect(formatLocalizedDate(null, 'fr')).toBe('');
    expect(formatLocalizedDate('not-a-date', 'fr')).toBe('');
    expect(formatLocalizedDate('1990/03/15', 'en')).toBe('');
  });
});
