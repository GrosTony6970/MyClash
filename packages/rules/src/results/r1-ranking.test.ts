import { describe, it, expect } from 'vitest';
import { rankBySeed, rankByRating, rankRandom, type SeedableEntrant } from './r1-ranking';

function reg(
  id: string,
  seed: number | null = null,
  bibNumber: number | null = null,
  hemaRatingsId: string | null = null,
): SeedableEntrant {
  return { id, seed, bibNumber, hemaRatingsId };
}

describe('rankBySeed (ruling 991)', () => {
  it('ranks by seed ORDER: seeds 1, 5, 8 are ranks 1, 2, 3', () => {
    expect(rankBySeed([reg('a', 1), reg('b', 5), reg('c', 8)])).toEqual([
      { rank: 1, entrantId: 'a' },
      { rank: 2, entrantId: 'b' },
      { rank: 3, entrantId: 'c' },
    ]);
  });

  it('keeps both Fighters on a repeated seed, by bib then by id', () => {
    expect(rankBySeed([reg('z', 3, null), reg('y', 3, 7), reg('x', 3, null), reg('w', 1)])).toEqual(
      [
        { rank: 1, entrantId: 'w' },
        { rank: 2, entrantId: 'y' },
        { rank: 3, entrantId: 'x' },
        { rank: 4, entrantId: 'z' },
      ],
    );
  });

  it('ranks the unseeded after the seeded, by bib (a missing bib last) then by id', () => {
    // An unseeded Fighter with bib 2 does not beat a Fighter seeded 3: the bib only breaks ties.
    expect(
      rankBySeed([reg('d', null, null), reg('c', null, 2), reg('b', 3), reg('a', null, null)]),
    ).toEqual([
      { rank: 1, entrantId: 'b' },
      { rank: 2, entrantId: 'c' },
      { rank: 3, entrantId: 'a' },
      { rank: 4, entrantId: 'd' },
    ]);
  });

  it('gives the same ranks whatever order the registrations come in', () => {
    const input = [
      reg('a', 2),
      reg('b', 2, 5),
      reg('c', null, 42),
      reg('d', null, null),
      reg('e', 1),
      reg('f', null, 9),
    ];
    const expected = [
      { rank: 1, entrantId: 'e' },
      { rank: 2, entrantId: 'b' },
      { rank: 3, entrantId: 'a' },
      { rank: 4, entrantId: 'f' },
      { rank: 5, entrantId: 'c' },
      { rank: 6, entrantId: 'd' },
    ];
    expect(rankBySeed(input)).toEqual(expected);
    expect(rankBySeed([...input].reverse())).toEqual(expected);
    expect(
      rankBySeed([input[3], input[0], input[5], input[2], input[4], input[1]] as SeedableEntrant[]),
    ).toEqual(expected);
  });

  it('does not mutate the input array', () => {
    const input = [reg('b', 2), reg('a', 1)];
    rankBySeed(input);
    expect(input.map((r) => r.id)).toEqual(['b', 'a']);
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
      { rank: 1, entrantId: 'b' },
      { rank: 2, entrantId: 'c' },
      { rank: 3, entrantId: 'a' },
    ]);
  });

  it('sorts unrated fighters last rather than treating them as rating 0', () => {
    const out = rankByRating([reg('unrated', 1, null, null), reg('rated', 9, null, 'h1')], ratings);
    expect(out).toEqual([
      { rank: 1, entrantId: 'rated' },
      { rank: 2, entrantId: 'unrated' },
    ]);
  });

  it('sorts a fighter whose hema id has no rating row alongside the unrated', () => {
    const out = rankByRating(
      [reg('missing', 1, null, 'h-unknown'), reg('rated', 2, null, 'h1')],
      ratings,
    );
    expect(out.map((r) => r.entrantId)).toEqual(['rated', 'missing']);
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
    expect(out.map((r) => r.entrantId)).toEqual(['a', 'b', 'c']);
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
    const a = rankRandom(pool, 42).map((r) => r.entrantId);
    const b = rankRandom(pool, 43).map((r) => r.entrantId);
    expect(a).not.toEqual(b);
  });

  it('ignores incoming row order, so the seed alone determines the draw', () => {
    const shuffledInput = [...pool].reverse();
    expect(rankRandom(shuffledInput, 7)).toEqual(rankRandom(pool, 7));
  });

  it('keeps every registration exactly once with dense ranks 1..N', () => {
    const out = rankRandom(pool, 99);
    expect(out.map((r) => r.rank)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(out.map((r) => r.entrantId).sort()).toEqual(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']);
  });

  it('actually shuffles rather than returning id order', () => {
    const out = rankRandom(pool, 42).map((r) => r.entrantId);
    expect(out).not.toEqual(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']);
  });

  it('handles empty and single-entry pools', () => {
    expect(rankRandom([], 1)).toEqual([]);
    expect(rankRandom([reg('solo', 1)], 1)).toEqual([{ rank: 1, entrantId: 'solo' }]);
  });

  it('does not mutate the input array', () => {
    const input = [...pool];
    rankRandom(input, 5);
    expect(input.map((r) => r.id)).toEqual(pool.map((r) => r.id));
  });
});
