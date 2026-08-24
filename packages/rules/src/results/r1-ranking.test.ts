import { describe, it, expect } from 'vitest';
import { rankBySeed, rankByRating, rankRandom, type SeedableRegistration } from './r1-ranking';

function reg(
  id: string,
  seed: number | null = null,
  bibNumber: number | null = null,
  hemaRatingsId: string | null = null,
): SeedableRegistration {
  return { id, seed, bibNumber, hemaRatingsId };
}

describe('rankBySeed', () => {
  it('uses the operator seed as the rank, not the list position', () => {
    expect(rankBySeed([reg('a', 1), reg('b', 5), reg('c', 8)])).toEqual([
      { rank: 1, registrationId: 'a' },
      { rank: 5, registrationId: 'b' },
      { rank: 8, registrationId: 'c' },
    ]);
  });

  it('falls back to bib number, then to list position', () => {
    expect(rankBySeed([reg('a', null, 3), reg('b', null, null), reg('c', 2)])).toEqual([
      { rank: 3, registrationId: 'a' },
      { rank: 2, registrationId: 'b' },
      { rank: 2, registrationId: 'c' },
    ]);
  });

  it('returns an empty list for no registrations', () => {
    expect(rankBySeed([])).toEqual([]);
  });
});

describe('rankByRating', () => {
  const ratings = new Map<string, number>([
    ['h1', 1200],
    ['h2', 1800],
    ['h3', 1500],
  ]);

  it('orders by weighted rating descending and densifies to 1..N', () => {
    const out = rankByRating(
      [reg('a', 1, null, 'h1'), reg('b', 2, null, 'h2'), reg('c', 3, null, 'h3')],
      ratings,
    );
    expect(out).toEqual([
      { rank: 1, registrationId: 'b' },
      { rank: 2, registrationId: 'c' },
      { rank: 3, registrationId: 'a' },
    ]);
  });

  it('sorts unrated fighters last rather than treating them as rating 0', () => {
    const out = rankByRating([reg('unrated', 1, null, null), reg('rated', 9, null, 'h1')], ratings);
    expect(out).toEqual([
      { rank: 1, registrationId: 'rated' },
      { rank: 2, registrationId: 'unrated' },
    ]);
  });

  it('sorts a fighter whose hema id has no rating row alongside the unrated', () => {
    const out = rankByRating(
      [reg('missing', 1, null, 'h-unknown'), reg('rated', 2, null, 'h1')],
      ratings,
    );
    expect(out.map((r) => r.registrationId)).toEqual(['rated', 'missing']);
  });

  it('breaks rating ties on seed, then on id, deterministically', () => {
    const tied = new Map<string, number>([
      ['x', 1000],
      ['y', 1000],
      ['z', 1000],
    ]);
    const out = rankByRating(
      [reg('c', 2, null, 'z'), reg('a', 1, null, 'x'), reg('b', 2, null, 'y')],
      tied,
    );
    // seed 1 first; the two seed-2 entries fall back to id order (b before c).
    expect(out.map((r) => r.registrationId)).toEqual(['a', 'b', 'c']);
  });

  it('does not mutate the input array', () => {
    const input = [reg('a', 1, null, 'h1'), reg('b', 2, null, 'h2')];
    rankByRating(input, ratings);
    expect(input.map((r) => r.id)).toEqual(['a', 'b']);
  });
});

describe('rankRandom', () => {
  const pool = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((id, i) => reg(id, i + 1));

  it('is reproducible: the same seed yields the same draw', () => {
    expect(rankRandom(pool, 42)).toEqual(rankRandom(pool, 42));
  });

  it('produces a different draw for a different seed', () => {
    const a = rankRandom(pool, 42).map((r) => r.registrationId);
    const b = rankRandom(pool, 43).map((r) => r.registrationId);
    expect(a).not.toEqual(b);
  });

  it('ignores incoming row order, so the seed alone determines the draw', () => {
    const shuffledInput = [...pool].reverse();
    expect(rankRandom(shuffledInput, 7)).toEqual(rankRandom(pool, 7));
  });

  it('keeps every registration exactly once with dense ranks 1..N', () => {
    const out = rankRandom(pool, 99);
    expect(out.map((r) => r.rank)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(out.map((r) => r.registrationId).sort()).toEqual([
      'a',
      'b',
      'c',
      'd',
      'e',
      'f',
      'g',
      'h',
    ]);
  });

  it('actually shuffles rather than returning id order', () => {
    const out = rankRandom(pool, 42).map((r) => r.registrationId);
    expect(out).not.toEqual(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']);
  });

  it('handles empty and single-entry pools', () => {
    expect(rankRandom([], 1)).toEqual([]);
    expect(rankRandom([reg('solo', 1)], 1)).toEqual([{ rank: 1, registrationId: 'solo' }]);
  });

  it('does not mutate the input array', () => {
    const input = [...pool];
    rankRandom(input, 5);
    expect(input.map((r) => r.id)).toEqual(pool.map((r) => r.id));
  });
});
