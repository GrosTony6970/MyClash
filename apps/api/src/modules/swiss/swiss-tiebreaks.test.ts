import { describe, expect, it } from 'vitest';
import type { RankingRule } from '@myclash/rulesets';
import {
  buildSwissRankingChain,
  headToHeadWithin,
  opponentTiebreaks,
  type SwissResultRecord,
} from './swiss-tiebreaks';

const record = (
  registrationId: string,
  swissPts: number,
  bouts: Array<[string, 'win' | 'draw' | 'loss']> = [],
): SwissResultRecord => ({
  registrationId,
  swissPts,
  bouts: bouts.map(([opponentId, outcome]) => ({ opponentId, outcome })),
});

describe('opponentTiebreaks', () => {
  /**
   * a beat b and drew with c; b lost to a and beat c; c drew a, lost to b.
   * Points: a = 3+1 = 4, b = 0+3 = 3, c = 1+0 = 1.
   */
  const field = [
    record('a', 4, [
      ['b', 'win'],
      ['c', 'draw'],
    ]),
    record('b', 3, [
      ['a', 'loss'],
      ['c', 'win'],
    ]),
    record('c', 1, [
      ['a', 'draw'],
      ['b', 'loss'],
    ]),
  ];
  const keys = opponentTiebreaks(field);

  it('sums opponent points for Buchholz', () => {
    expect(keys.get('a')!.buchholz).toBe(3 + 1);
    expect(keys.get('b')!.buchholz).toBe(4 + 1);
    expect(keys.get('c')!.buchholz).toBe(4 + 3);
  });

  it('drops the WEAKEST opponent for Buchholz cut-1', () => {
    // a faced b(3) and c(1); cutting the 1 leaves 3.
    expect(keys.get('a')!.buchholzCut1).toBe(3);
    expect(keys.get('c')!.buchholzCut1).toBe(4);
  });

  it('weights Sonneborn-Berger by how you did against them', () => {
    // a: full credit for beating b(3), half for drawing c(1) → 3 + 0.5.
    expect(keys.get('a')!.sonnebornBerger).toBe(3.5);
    // b: beat c(1) → 1, lost to a → 0.
    expect(keys.get('b')!.sonnebornBerger).toBe(1);
    // c: drew a(4) → 2, lost to b → 0.
    expect(keys.get('c')!.sonnebornBerger).toBe(2);
  });

  it('computes opponent win % over the opponents’ whole records', () => {
    // a faced b (1 win in 2) and c (0 wins in 2) → 1/4.
    expect(keys.get('a')!.opponentWinPct).toBe(0.25);
  });

  it('gives a fighter with no bouts zero on every key', () => {
    const only = opponentTiebreaks([record('lonely', 3)]).get('lonely')!;
    expect(only).toEqual({
      buchholz: 0,
      buchholzCut1: 0,
      sonnebornBerger: 0,
      opponentWinPct: 0,
    });
  });

  it('adds nothing for a bye, which is not a bout', () => {
    // A bye already scored its points; it is deliberately absent from `bouts`,
    // so it contributes 0 to every opponent-derived key. FIDE's virtual
    // opponent is a documented follow-up.
    const byeOnly = opponentTiebreaks([record('a', 3), record('b', 0, [])]);
    expect(byeOnly.get('a')!.buchholz).toBe(0);
  });

  it('scores an opponent outside the field as 0 rather than breaking', () => {
    const keys2 = opponentTiebreaks([record('a', 3, [['ghost', 'win']])]);
    expect(keys2.get('a')!.buchholz).toBe(0);
    expect(keys2.get('a')!.sonnebornBerger).toBe(0);
  });

  it('rounds SB and opponent win% to 2dp so display and ranking agree', () => {
    const keys2 = opponentTiebreaks([
      record('a', 0, [
        ['b', 'win'],
        ['c', 'win'],
        ['d', 'win'],
      ]),
      record('b', 1, [['a', 'loss']]),
      record('c', 1, [['a', 'loss']]),
      record('d', 1, [['a', 'loss']]),
    ]);
    expect(keys2.get('a')!.opponentWinPct).toBe(0);
    expect(Number.isInteger(keys2.get('a')!.sonnebornBerger * 100)).toBe(true);
  });
});

describe('headToHeadWithin', () => {
  const field = [
    record('a', 3, [
      ['b', 'win'],
      ['c', 'loss'],
    ]),
    record('b', 3, [
      ['a', 'loss'],
      ['c', 'win'],
    ]),
    record('c', 3, [
      ['a', 'win'],
      ['b', 'loss'],
    ]),
  ];

  it('counts wins minus losses inside the block only', () => {
    const net = headToHeadWithin(['a', 'b'], field);
    // Between just a and b: a beat b.
    expect(net.get('a')).toBe(1);
    expect(net.get('b')).toBe(-1);
  });

  it('ignores results against fighters outside the block', () => {
    const net = headToHeadWithin(['a', 'b'], field);
    // a also lost to c, but c is not in this block, so it does not count.
    expect(net.get('a')).toBe(1);
  });

  it('returns nothing for fighters outside the block', () => {
    expect(headToHeadWithin(['a'], field).has('b')).toBe(false);
  });

  it('handles a perfect cycle by giving everyone zero', () => {
    // a beat b, b beat c, c beat a — head-to-head cannot separate them, which
    // is the honest answer rather than an arbitrary order.
    const net = headToHeadWithin(['a', 'b', 'c'], field);
    expect([...net.values()]).toEqual([0, 0, 0]);
  });
});

describe('buildSwissRankingChain', () => {
  const rulesetChain: RankingRule[] = [
    { key: 'W', direction: 'desc' },
    { key: 'diff', direction: 'desc' },
  ];

  it('puts swissPts first by default', () => {
    const chain = buildSwissRankingChain('swissPts', ['buchholz'], rulesetChain);
    expect(chain[0]).toEqual({ key: 'swissPts', direction: 'desc' });
    expect(chain[1]).toEqual({ key: 'buchholz', direction: 'desc' });
  });

  it('puts the ruleset score first when rankBy says so', () => {
    const chain = buildSwissRankingChain('rulesetScore', ['buchholz'], rulesetChain);
    expect(chain[0]).toEqual({ key: 'score', direction: 'desc' });
  });

  it('splices the ruleset chain in where the sentinel sits', () => {
    const chain = buildSwissRankingChain(
      'swissPts',
      ['buchholz', 'rulesetChain', 'sonnebornBerger'],
      rulesetChain,
    );
    expect(chain.map((r) => r.key)).toEqual([
      'swissPts',
      'buchholz',
      'W',
      'diff',
      'sonnebornBerger',
      'score',
    ]);
  });

  it('keeps the OTHER primary candidate as a last resort', () => {
    // Ranking on points still falls back to the ruleset score, and vice versa —
    // both are meaningful, so neither is thrown away.
    expect(buildSwissRankingChain('swissPts', [], []).map((r) => r.key)).toEqual([
      'swissPts',
      'score',
    ]);
    expect(buildSwissRankingChain('rulesetScore', [], []).map((r) => r.key)).toEqual([
      'score',
      'swissPts',
    ]);
  });

  it('drops a repeat so it cannot mask the key before it', () => {
    // `score` from the spliced ruleset chain must not reappear when it is
    // already the primary.
    const chain = buildSwissRankingChain(
      'rulesetScore',
      ['rulesetChain'],
      [
        { key: 'score', direction: 'desc' },
        { key: 'W', direction: 'desc' },
      ],
    );
    expect(chain.map((r) => r.key)).toEqual(['score', 'W', 'swissPts']);
  });

  it('sorts damage-taken keys ascending, everything else descending', () => {
    const chain = buildSwissRankingChain('swissPts', ['hitsReceived', 'doubles', 'buchholz'], []);
    const dir = Object.fromEntries(chain.map((r) => [r.key, r.direction]));
    expect(dir['hitsReceived']).toBe('asc');
    expect(dir['doubles']).toBe('asc');
    expect(dir['buchholz']).toBe('desc');
  });
});
