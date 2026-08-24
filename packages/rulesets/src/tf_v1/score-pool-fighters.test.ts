/**
 * TF_v1's pool scoring, and the chain that orders it.
 *
 * Replaces `standings.test.ts`, which went with `computePoolStandings`. That
 * file asserted a five-key sort TF_v1 no longer owns: the ruleset returned rows
 * it had sorted itself, and the API threw that ordering away and re-ranked with
 * `applyRanking(rows, rankingChain)` — over a chain of FOUR keys, not five. So
 * the old file tested a sorter that never decided a placement.
 *
 * What is tested here is what actually runs: the score TF_v1 computes, and the
 * declared chain executed over it.
 *
 * Written after a seeded break in the new accumulation left the whole API suite
 * AND the whole rulesets suite green — the API stubs the ruleset, and deleting
 * `standings.test.ts` had taken the only direct coverage with it.
 */
import { describe, it, expect } from 'vitest';
import { applyRanking, type StandingsRow } from '@myclash/rules/results';
import { TF_v1 } from './index';
import { TFv1DefaultConfig } from './config';
import type { Exchange, ScoredMatch } from '../types';

function clean(matchId: string, seq: number, striker: 'red' | 'blue', value = 1): Exchange {
  return {
    id: `${matchId}-${seq}`,
    clientUuid: `${matchId}-${seq}`,
    matchId,
    sequence: seq,
    type: 'clean',
    occurredAt: '',
    firstStrikerColor: striker,
    firstStrikeValue: value,
    afterblowValue: null,
    noExchangeReason: null,
    voided: false,
  };
}

function double(matchId: string, seq: number): Exchange {
  return { ...clean(matchId, seq, 'red'), type: 'double', firstStrikerColor: null };
}

function bout(
  id: string,
  red: string,
  blue: string,
  winner: string | null,
  exchanges: Exchange[],
): ScoredMatch {
  return {
    id,
    redRegistrationId: red,
    blueRegistrationId: blue,
    winnerRegistrationId: winner,
    exchanges,
  };
}

const score = (ids: string[], matches: ScoredMatch[], mode: 'full' | 'deductive' = 'full') =>
  TF_v1.scorePoolFighters({
    registrationIds: ids,
    completedMatches: matches,
    afterblowMode: mode,
    config: TFv1DefaultConfig,
  });

describe('TF_v1 scorePoolFighters', () => {
  it('is (wins x winBonus + targetPoints) / (timesHit + doublePenalty(doubles))', () => {
    // r1 lands three 1-point hits and wins; r2 is hit three times and loses.
    // r1: wins 1, points 3, hit 0, doubles 0 → (3 + 3) / 0 → numerator, 6.
    // r2: wins 0, points 0, hit 3, doubles 0 → (0 + 0) / 3 = 0.
    const matches = [
      bout('m1', 'r1', 'r2', 'r1', [
        clean('m1', 1, 'red'),
        clean('m1', 2, 'red'),
        clean('m1', 3, 'red'),
      ]),
    ];
    const scores = score(['r1', 'r2'], matches);
    expect(scores.get('r1')).toBe(6);
    expect(scores.get('r2')).toBe(0);
  });

  it('accumulates across every bout a fighter fought', () => {
    // Two bouts, both won by r1, two points each. wins 2, points 4, hit 0.
    // (2 x 3 + 4) / 0 → 10. One bout alone would give (3 + 2) / 0 = 5, so this
    // reds if the running totals are dropped rather than summed.
    const matches = [
      bout('m1', 'r1', 'r2', 'r1', [clean('m1', 1, 'red', 2)]),
      bout('m2', 'r1', 'r3', 'r1', [clean('m2', 1, 'red', 2)]),
    ];
    expect(score(['r1', 'r2', 'r3'], matches).get('r1')).toBe(10);
  });

  it('scores a fighter who fought nothing rather than omitting them', () => {
    // A fighter with a bye must still get a row, or the table loses them.
    expect(score(['r1'], []).get('r1')).toBe(0);
    expect(score(['r1'], []).size).toBe(1);
  });

  it('ignores a bout between fighters outside the list', () => {
    const scores = score(['r1'], [bout('m1', 'r8', 'r9', 'r8', [clean('m1', 1, 'red')])]);
    expect(scores.get('r1')).toBe(0);
    expect(scores.size).toBe(1);
  });

  it('excludes voided exchanges', () => {
    const voided = { ...clean('m1', 1, 'red', 2), voided: true };
    const scores = score(['r1', 'r2'], [bout('m1', 'r1', 'r2', 'r1', [voided])]);
    // Only the win bonus survives: (3 + 0) / 0 → 3.
    expect(scores.get('r1')).toBe(3);
  });

  it('nets afterblows by the mode it is HANDED', () => {
    const afterblow: Exchange = {
      ...clean('m1', 1, 'red', 2),
      type: 'afterblow',
      afterblowValue: 1,
    };
    const matches = [bout('m1', 'r1', 'r2', 'r1', [afterblow])];
    // Full: r1 keeps 2, r2 keeps 1. r1 = (3 + 2) / 1 = 5; r2 = (0 + 1) / 0 → 1.
    expect(score(['r1', 'r2'], matches, 'full').get('r1')).toBe(5);
    expect(score(['r1', 'r2'], matches, 'full').get('r2')).toBe(1);
    // Deductive: r1 keeps 2 - 1 = 1, r2 gets 0. r1 = (3 + 1) / 1 = 4; r2 = 0.
    expect(score(['r1', 'r2'], matches, 'deductive').get('r1')).toBe(4);
    expect(score(['r1', 'r2'], matches, 'deductive').get('r2')).toBe(0);
  });

  it('scores a target worth more than 2, which the DTO has always allowed', () => {
    // `Exchange.firstStrikeValue` was typed `1 | 2 | null` while the DTO accepts
    // 1..10 and the column is a plain INTEGER. The arithmetic never cared, so
    // this is the assertion the type was standing in the way of writing.
    //
    // The same assumption is ALSO in SQL and is a live defect there:
    // `fighter_exchange_stats` buckets 1, 2 and 3 by hand (migration 0136), so a
    // 4-point target is invisible in every stats column. That needs a migration.
    const matches = [bout('m1', 'r1', 'r2', 'r1', [clean('m1', 1, 'red', 4)])];
    // r1: (3 + 4) / 0 → 7. A value silently clamped to 2 would give 5.
    expect(score(['r1', 'r2'], matches).get('r1')).toBe(7);
  });

  it('reads winBonus and the double penalty from the CONFIG, not from constants', () => {
    // A super-admin amending the federal rulebook must change the answer.
    const matches = [bout('m1', 'r1', 'r2', 'r1', [clean('m1', 1, 'red'), double('m1', 2)])];
    const withBonus = (winBonus: number) =>
      TF_v1.scorePoolFighters({
        registrationIds: ['r1'],
        completedMatches: matches,
        afterblowMode: 'full',
        config: { ...TFv1DefaultConfig, winBonus },
      }).get('r1');
    // Denominator is the same in both; only the win bonus moves the numerator.
    expect(withBonus(3)).not.toBe(withBonus(10));
  });
});

describe('the TF_v1 ranking chain, executed', () => {
  const row = (id: string, stats: Record<string, number>): StandingsRow => ({
    rank: 0,
    registrationId: id,
    displayName: id,
    club: null,
    status: 'completed',
    stats,
  });

  const order = (rows: StandingsRow[]) =>
    applyRanking(rows, TF_v1.rankingChain).map((r) => r.registrationId);

  it('declares score, then wins, then doubles, then hits received', () => {
    // The chain IS the tiebreak order. Pinning it here is what makes the three
    // cases below name a specific step rather than a general "it sorts".
    expect(TF_v1.rankingChain).toEqual([
      { key: 'score', direction: 'desc' },
      { key: 'W', direction: 'desc' },
      { key: 'doubles', direction: 'asc' },
      { key: 'hitsReceived', direction: 'asc' },
    ]);
  });

  it('tiebreak 1: higher score first', () => {
    expect(order([row('a', { score: 2 }), row('b', { score: 5 })])).toEqual(['b', 'a']);
  });

  it('tiebreak 2: level on score, more wins first', () => {
    expect(order([row('a', { score: 4, W: 1 }), row('b', { score: 4, W: 3 })])).toEqual(['b', 'a']);
  });

  it('tiebreak 3: level on score and wins, FEWER doubles first', () => {
    // Untested before this file existed. Note the direction: ascending, so the
    // fighter with more doubles is placed lower.
    expect(
      order([row('a', { score: 4, W: 2, doubles: 5 }), row('b', { score: 4, W: 2, doubles: 1 })]),
    ).toEqual(['b', 'a']);
  });

  it('tiebreak 4: level on score, wins and doubles, FEWER hits received first', () => {
    // Also untested before this file. This is the last declared step.
    expect(
      order([
        row('a', { score: 4, W: 2, doubles: 1, hitsReceived: 9 }),
        row('b', { score: 4, W: 2, doubles: 1, hitsReceived: 2 }),
      ]),
    ).toEqual(['b', 'a']);
  });

  it('stops at the FIRST key that differs, so a later key cannot overturn it', () => {
    // a has more doubles (worse on tiebreak 3) but a higher score, and score is
    // first. A chain applied in the wrong order would put b on top.
    expect(
      order([
        row('a', { score: 9, W: 1, doubles: 8, hitsReceived: 9 }),
        row('b', { score: 4, W: 5, doubles: 0, hitsReceived: 0 }),
      ]),
    ).toEqual(['a', 'b']);
  });
});
