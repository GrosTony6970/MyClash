import { describe, it, expect } from 'vitest';
import { sortParticipants, filterParticipants, type SortKey } from './participants-table';

type Row = {
  displayName: string;
  clubName: string | null;
  clubAbbrev: string | null;
  hemaRating: { weightedRating: number } | null;
};

function row(p: Partial<Row> & { displayName: string }): Row {
  return { clubName: null, clubAbbrev: null, hemaRating: null, ...p };
}

const A = row({ displayName: 'Alice', clubName: 'Zeta', hemaRating: { weightedRating: 1400 } });
const B = row({ displayName: 'bob', clubName: 'Alpha', hemaRating: { weightedRating: 1600 } });
const C = row({ displayName: 'Chloé', clubName: null, hemaRating: null });

const ids = (rows: Row[]) => rows.map((r) => r.displayName);

describe('sortParticipants', () => {
  it('sorts by name, case-insensitive, both directions', () => {
    expect(ids(sortParticipants([B, A, C], 'name', 'asc'))).toEqual(['Alice', 'bob', 'Chloé']);
    expect(ids(sortParticipants([B, A, C], 'name', 'desc'))).toEqual(['Chloé', 'bob', 'Alice']);
  });

  it('sorts by club with null clubs last (both directions)', () => {
    expect(ids(sortParticipants([A, B, C], 'club', 'asc'))).toEqual(['bob', 'Alice', 'Chloé']);
    expect(ids(sortParticipants([A, B, C], 'club', 'desc'))).toEqual(['Alice', 'bob', 'Chloé']);
  });

  it('sorts by rating numerically with unrated last (both directions)', () => {
    expect(ids(sortParticipants([A, B, C], 'rating', 'desc'))).toEqual(['bob', 'Alice', 'Chloé']);
    expect(ids(sortParticipants([A, B, C], 'rating', 'asc'))).toEqual(['Alice', 'bob', 'Chloé']);
  });

  it('does not mutate the input array', () => {
    const input = [B, A];
    sortParticipants(input, 'name', 'asc');
    expect(ids(input)).toEqual(['bob', 'Alice']);
  });
});

describe('filterParticipants', () => {
  it('returns all rows for an empty query', () => {
    expect(filterParticipants([A, B, C], '   ').length).toBe(3);
  });

  it('matches name + club, accent- and case-insensitive', () => {
    expect(ids(filterParticipants([A, B, C], 'chloe'))).toEqual(['Chloé']);
    expect(ids(filterParticipants([A, B, C], 'alpha'))).toEqual(['bob']);
    expect(ids(filterParticipants([A, B, C], 'ALICE'))).toEqual(['Alice']);
  });

  it('matches the club abbreviation too', () => {
    const r = row({ displayName: 'Dan', clubAbbrev: 'REGHT' });
    expect(ids(filterParticipants([r], 'reght'))).toEqual(['Dan']);
  });
});
