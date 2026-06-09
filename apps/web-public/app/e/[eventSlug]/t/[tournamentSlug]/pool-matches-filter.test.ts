import { describe, it, expect } from 'vitest';
import { matchesQuery, type FilterableMatch } from './pool-matches-filter';

const row: FilterableMatch = {
  roundCode: 'LSW-P1-ML1-PA-M2',
  redFighterName: 'Thomas Adrien',
  blueFighterName: 'Anthony Garnier',
  redClubAbbrev: 'Compagnie Excalibur Yvelines',
  blueClubAbbrev: 'Lyon AMHE',
  status: 'completed',
  liceName: 'Lice 1',
};

describe('matchesQuery', () => {
  it('keeps every row for an empty / whitespace query', () => {
    expect(matchesQuery(row, '')).toBe(true);
    expect(matchesQuery(row, '   ')).toBe(true);
  });

  it('matches a fighter name case-insensitively', () => {
    expect(matchesQuery(row, 'adrien')).toBe(true);
    expect(matchesQuery(row, 'GARNIER')).toBe(true);
  });

  it('matches the round code, status, lice, and club', () => {
    expect(matchesQuery(row, 'm2')).toBe(true);
    expect(matchesQuery(row, 'completed')).toBe(true);
    expect(matchesQuery(row, 'lice 1')).toBe(true);
    expect(matchesQuery(row, 'lyon')).toBe(true);
  });

  it('folds accents so an unaccented query matches an accented name', () => {
    const accented: FilterableMatch = { ...row, redFighterName: 'Rémi Arbache' };
    expect(matchesQuery(accented, 'remi')).toBe(true);
  });

  it('returns false when nothing matches', () => {
    expect(matchesQuery(row, 'zzz')).toBe(false);
  });
});
