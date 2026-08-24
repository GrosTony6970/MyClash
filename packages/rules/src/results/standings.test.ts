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
