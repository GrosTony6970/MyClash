import { describe, expect, it } from 'vitest';
import { FFAMHE_POINTS, fuzzyMatch, toSlug } from './league-utils';

describe('toSlug', () => {
  it('lowercases and replaces spaces with hyphens', () => {
    expect(toSlug('France League 2026')).toBe('france-league-2026');
  });
  it('strips French diacritics', () => {
    expect(toSlug('Ligue HÉMA')).toBe('ligue-hema');
  });
  it('collapses consecutive non-alphanumeric chars into one hyphen', () => {
    expect(toSlug('Hello  World!')).toBe('hello-world');
  });
  it('trims leading and trailing hyphens', () => {
    expect(toSlug('  Hello ')).toBe('hello');
  });
  it('handles empty string', () => {
    expect(toSlug('')).toBe('');
  });
});

describe('fuzzyMatch', () => {
  it('matches when all query chars appear in order', () => {
    expect(fuzzyMatch('fal', 'FAL 2026')).toBe(true);
  });
  it('strips diacritics in both strings', () => {
    expect(fuzzyMatch('hema', 'HÉMA France')).toBe(true);
  });
  it('returns false when a char is missing', () => {
    expect(fuzzyMatch('xyz', 'FAL 2026')).toBe(false);
  });
  it('returns true for empty query', () => {
    expect(fuzzyMatch('', 'anything')).toBe(true);
  });
});

describe('FFAMHE_POINTS', () => {
  it('gives rank 1 → 16 points', () => {
    expect(FFAMHE_POINTS[1]).toBe(16);
  });
  it('gives rank 16 → 1 point', () => {
    expect(FFAMHE_POINTS[16]).toBe(1);
  });
  it('has exactly 16 entries', () => {
    expect(Object.keys(FFAMHE_POINTS).length).toBe(16);
  });
});
