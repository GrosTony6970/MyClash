import { describe, expect, it } from 'vitest';
import { isValidTime24, normalizeTime24 } from './time24';

describe('normalizeTime24', () => {
  it('passes a valid HH:MM through unchanged', () => {
    expect(normalizeTime24('09:00')).toBe('09:00');
    expect(normalizeTime24('23:59')).toBe('23:59');
  });

  it('zero-pads short colon forms', () => {
    expect(normalizeTime24('9:5')).toBe('09:05');
    expect(normalizeTime24('9:00')).toBe('09:00');
  });

  it('parses digit-only input', () => {
    expect(normalizeTime24('0900')).toBe('09:00');
    expect(normalizeTime24('905')).toBe('09:05');
    expect(normalizeTime24('14')).toBe('14:00');
  });

  it('rejects out-of-range and garbage', () => {
    expect(normalizeTime24('25:00')).toBeNull();
    expect(normalizeTime24('12:60')).toBeNull();
    expect(normalizeTime24('abc')).toBeNull();
    expect(normalizeTime24('')).toBeNull();
    expect(normalizeTime24('   ')).toBeNull();
  });
});

describe('isValidTime24', () => {
  it('accepts only canonical 24h HH:MM', () => {
    expect(isValidTime24('09:00')).toBe(true);
    expect(isValidTime24('23:59')).toBe(true);
    expect(isValidTime24('9:00')).toBe(false);
    expect(isValidTime24('24:00')).toBe(false);
    expect(isValidTime24('')).toBe(false);
  });
});
