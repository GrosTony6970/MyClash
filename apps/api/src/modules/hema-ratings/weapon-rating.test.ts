import { describe, it, expect } from 'vitest';
import {
  pickWeaponRating,
  normalizePersonName,
  buildNameRatingIndex,
  type RatingRow,
  type SnapshotFighter,
} from './weapon-rating';

const NOW = new Date('2026-06-10T00:00:00Z');
const recent = '2026-01-01';
const stale = '2020-01-01'; // > 2 years before NOW

function row(p: Partial<RatingRow>): RatingRow {
  return {
    weapon: 'Longsword',
    category: 'Open',
    rank: 1,
    weightedRating: 1500,
    lastCompeted: recent,
    ...p,
  };
}

describe('pickWeaponRating', () => {
  it('returns null for no rows or a weapon with no match', () => {
    expect(pickWeaponRating([], 'Longsword', NOW)).toBeNull();
    expect(pickWeaponRating([row({ weapon: 'Rapier' })], 'Longsword', NOW)).toBeNull();
  });

  it('matches the weapon case-insensitively and returns weightedRating + rank', () => {
    const out = pickWeaponRating(
      [row({ weapon: 'Longsword', weightedRating: 1583.4, rank: 42 })],
      'longsword',
      NOW,
    );
    expect(out).toEqual({ weightedRating: 1583.4, rank: 42 });
  });

  it('excludes stale (>2y) and missing-date rows', () => {
    expect(pickWeaponRating([row({ lastCompeted: stale })], 'Longsword', NOW)).toBeNull();
    expect(pickWeaponRating([row({ lastCompeted: null })], 'Longsword', NOW)).toBeNull();
  });

  it('picks the most recently competed row when several match', () => {
    const out = pickWeaponRating(
      [
        row({ weightedRating: 1400, rank: 99, lastCompeted: '2025-02-01' }),
        row({ weightedRating: 1620, rank: 12, lastCompeted: '2026-03-01' }),
      ],
      'Longsword',
      NOW,
    );
    expect(out).toEqual({ weightedRating: 1620, rank: 12 });
  });

  it('allows a null rank', () => {
    expect(pickWeaponRating([row({ rank: null, weightedRating: 1500 })], 'Longsword', NOW)).toEqual(
      {
        weightedRating: 1500,
        rank: null,
      },
    );
  });
});

describe('normalizePersonName', () => {
  it('folds case + accents and is order-insensitive', () => {
    expect(normalizePersonName('Rémi Arbache')).toBe(normalizePersonName('ARBACHE  rémi'));
  });
  it('treats punctuation as separators consistently', () => {
    expect(normalizePersonName('Jean-François Biras')).toBe(
      normalizePersonName('biras jean francois'),
    );
  });
});

function fighter(p: Partial<SnapshotFighter> & { name: string }): SnapshotFighter {
  return { id: p.id ?? '1', name: p.name, ratings: p.ratings ?? [row({})] };
}

describe('buildNameRatingIndex', () => {
  it('indexes a uniquely-named, rated fighter by normalized name', () => {
    const idx = buildNameRatingIndex(
      [
        fighter({
          id: '1',
          name: 'Rémi Arbache',
          ratings: [row({ weightedRating: 1583, rank: 7 })],
        }),
      ],
      'Longsword',
      NOW,
    );
    expect(idx.get(normalizePersonName('Remi Arbache'))).toEqual({ weightedRating: 1583, rank: 7 });
  });

  it('drops a normalized name shared by 2+ fighters (ambiguous)', () => {
    const idx = buildNameRatingIndex(
      [
        fighter({ id: '1', name: 'John Smith', ratings: [row({ weightedRating: 1500 })] }),
        fighter({ id: '2', name: 'John Smith', ratings: [row({ weightedRating: 1700 })] }),
      ],
      'Longsword',
      NOW,
    );
    expect(idx.has(normalizePersonName('John Smith'))).toBe(false);
  });

  it('excludes fighters with no rating for the weapon', () => {
    const idx = buildNameRatingIndex(
      [fighter({ name: 'Rapier Only', ratings: [row({ weapon: 'Rapier' })] })],
      'Longsword',
      NOW,
    );
    expect(idx.size).toBe(0);
  });
});
