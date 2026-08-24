/**
 * applyRanking is the single ordering authority; it now also records, per row,
 * the rankingChain key that separated a fighter from the one directly above —
 * turning "why am I 3rd?" into data a fighter page can render.
 */
import { describe, expect, it } from 'vitest';
import type { RankingRule } from '../ranking';
import { applyRanking, type StandingsRow } from './standings';

const CHAIN: RankingRule[] = [
  { key: 'score', direction: 'desc' },
  { key: 'wins', direction: 'desc' },
  { key: 'doubles', direction: 'asc' },
];

function row(registrationId: string, stats: Record<string, number>): StandingsRow {
  return {
    rank: 0,
    registrationId,
    displayName: registrationId,
    club: null,
    status: 'completed',
    stats,
  };
}

describe('applyRanking — deciding tiebreak', () => {
  const ranked = applyRanking(
    [
      row('C', { score: 8, wins: 3, doubles: 0 }),
      row('D', { score: 8, wins: 3, doubles: 0 }),
      row('A', { score: 10, wins: 5, doubles: 1 }),
      row('B', { score: 10, wins: 4, doubles: 2 }),
    ],
    CHAIN,
  );
  const by = (id: string) => ranked.find((r) => r.registrationId === id)!;

  it('sorts by the chain and assigns sequential ranks', () => {
    expect(ranked.map((r) => r.registrationId)).toEqual(['A', 'B', 'C', 'D']);
    expect(ranked.map((r) => r.rank)).toEqual([1, 2, 3, 4]);
  });

  it('gives the leader no deciding tiebreak', () => {
    expect(by('A').decidingTiebreak).toBe(null);
  });

  it('reports the first chain key on which a fighter differs from the one above', () => {
    // B trails A on wins (score is equal).
    expect(by('B').decidingTiebreak).toEqual({
      key: 'wins',
      direction: 'desc',
      mine: 4,
      theirs: 5,
    });
    // C trails B on score (the very first key).
    expect(by('C').decidingTiebreak).toEqual({
      key: 'score',
      direction: 'desc',
      mine: 8,
      theirs: 10,
    });
  });

  it('reports null for a fighter tied with the one above on every chain key', () => {
    expect(by('D').decidingTiebreak).toBe(null);
  });
});

describe('the terminal ordering key', () => {
  /** Two fighters level on every declared key, so only the terminal key is left. */
  const tied = (registrationId: string, displayName: string): StandingsRow => ({
    rank: 0,
    registrationId,
    displayName,
    club: null,
    status: 'completed',
    stats: { score: 5, wins: 2, doubles: 1 },
  });

  it('orders a full tie by code point, so the runner locale cannot change a rank', () => {
    // `'Ähtäri'.localeCompare('Zoe')` is -1 under `en` and +1 under `sv`. Code
    // points have no locale, so these hold on every machine — and they red if
    // anyone reintroduces localeCompare, because `en` would disagree with all
    // three.
    const order = (a: StandingsRow, b: StandingsRow) =>
      applyRanking([a, b], CHAIN).map((r) => r.displayName);

    expect(order(tied('f-a', 'Ähtäri'), tied('f-b', 'Zoe'))).toEqual(['Zoe', 'Ähtäri']);
    expect(order(tied('f-a', 'Émile'), tied('f-b', 'Zoe'))).toEqual(['Zoe', 'Émile']);
    // Capitals before lowercase, for the same reason.
    expect(order(tied('f-a', 'alice'), tied('f-b', 'Bob'))).toEqual(['Bob', 'alice']);
  });

  it('does not depend on the order the rows arrived in', () => {
    // This is the defect: `applyRanking` returned 0 on a full tie and fell to
    // input order, which is whatever PostgREST returned. Pool rank feeds bracket
    // promotion, so the two reads below deciding differently is a seeding bug,
    // not a display wobble.
    const ada = tied('f-ada', 'Ada');
    const grace = tied('f-grace', 'Grace');
    expect(applyRanking([ada, grace], CHAIN).map((r) => r.registrationId)).toEqual(
      applyRanking([grace, ada], CHAIN).map((r) => r.registrationId),
    );
  });

  it('falls through to the registration id when two fighters share a name', () => {
    const first = tied('f-a', 'Alex Martin');
    const second = tied('f-b', 'Alex Martin');
    expect(applyRanking([second, first], CHAIN).map((r) => r.registrationId)).toEqual([
      'f-a',
      'f-b',
    ]);
  });

  it('never overrides a declared key', () => {
    // 'Zoe' would lose the terminal comparison, but she is ahead on `score`,
    // which is first in the chain. A terminal key that could outrank a declared
    // one would be a different bug from the one being fixed.
    const zoe: StandingsRow = { ...tied('f-z', 'Zoe'), stats: { score: 9, wins: 2, doubles: 1 } };
    const ada = tied('f-a', 'Ada');
    expect(applyRanking([ada, zoe], CHAIN).map((r) => r.displayName)).toEqual(['Zoe', 'Ada']);
  });

  it('is NOT reported as a deciding tiebreak', () => {
    // Load-bearing, not cosmetic. SwissStandingsService builds its head-to-head
    // tie blocks from `decidingTiebreak === null`, so a terminal key that
    // reported itself would collapse every block to a single row and
    // head-to-head would never fire again. That is also why this key lives here
    // rather than being appended to each ruleset's rankingChain.
    const ranked = applyRanking([tied('f-a', 'Ada'), tied('f-b', 'Grace')], CHAIN);
    expect(ranked[0]?.decidingTiebreak).toBeNull();
    expect(ranked[1]?.decidingTiebreak).toBeNull();
  });
});
