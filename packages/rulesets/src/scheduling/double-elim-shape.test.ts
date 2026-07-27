import { describe, it, expect } from 'vitest';
import { doubleElimBracket, totalDoubleElimMatches } from './double-elim';
import { expectRefsResolve, lbRoundSizes } from './double-elim-test-helpers';

/**
 * Podium options and repechage cutoffs — the Slice 2 surface of the
 * double-elim generator. Classical (gold, no cutoff) brackets are covered by
 * `double-elim.test.ts`; these tests only exercise what the new options change.
 *
 * The load-bearing claim is that a repechage with cutoff K is EXACTLY the
 * losers bracket of a K-sized double elim, so the ladders below must match the
 * unrestricted ladders of the corresponding smaller bracket.
 */

/** Absolute WB rounds that any LB slot pulls a dropped loser from. */
function wbDropRounds(b: ReturnType<typeof doubleElimBracket>): number[] {
  const rounds = new Set<number>();
  for (const slot of b.slots) {
    for (const ref of [slot.homeSource, slot.awaySource]) {
      const m = /^loser of WBR(\d+)P\d+$/.exec(ref);
      if (m) rounds.add(Number(m[1]));
    }
  }
  return [...rounds].sort((a, c) => a - c);
}

describe('repechage cutoff (repechageEntrySize)', () => {
  it('defaults to the whole bracket — everyone gets a second chance', () => {
    const b = doubleElimBracket(16);
    expect(b.repechageEntrySize).toBe(16);
    expect(b.repechageEntryRound).toBe(1);
    expect(lbRoundSizes(b)).toEqual([4, 4, 2, 2, 1, 1]);
  });

  /**
   * The structural insight, asserted directly: cutting a 32-bracket to "last
   * 8" must produce the same losers ladder as an unrestricted 8-bracket.
   */
  it.each([
    [32, 8],
    [32, 16],
    [16, 8],
    [64, 16],
  ])('a %i-bracket cut to last %i has the LB ladder of a %i-bracket', (size, k) => {
    const cut = doubleElimBracket(size, { repechageEntrySize: k });
    const native = doubleElimBracket(k);
    expect(lbRoundSizes(cut)).toEqual(lbRoundSizes(native));
    expect(cut.lbRounds).toBe(native.lbRounds);
  });

  it('enters at the WB round where exactly K fighters remain', () => {
    // 32-bracket: wbRounds=5. "Last 8" is the round of 8 = WB round 3.
    const b = doubleElimBracket(32, { repechageEntrySize: 8 });
    expect(b.repechageEntryRound).toBe(3);
    // Rounds 1 and 2 eliminate outright, so nothing drops from them.
    expect(wbDropRounds(b)).toEqual([3, 4, 5]);
  });

  it('takes K-1 entrants, exactly a K-bracket losers intake', () => {
    const b = doubleElimBracket(32, { repechageEntrySize: 8 });
    const dropped = b.slots.flatMap((s) =>
      [s.homeSource, s.awaySource].filter((r) => /^loser of WBR/.test(r)),
    );
    expect(dropped.length).toBe(7); // 8/2 + 8/4 + 8/8
  });

  it('keeps every advancement ref resolvable at every legal cutoff', () => {
    for (const size of [8, 16, 32, 64]) {
      for (const k of [8, 16, 32]) {
        if (k > size) continue;
        expectRefsResolve(doubleElimBracket(size, { repechageEntrySize: k }));
        expectRefsResolve(
          doubleElimBracket(size, { repechageEntrySize: k, grandFinalReset: true }),
        );
      }
    }
  });

  it('still ends in one grand final against the WB winner', () => {
    const b = doubleElimBracket(32, { repechageEntrySize: 8 });
    const gf = b.slots.find((s) => s.section === 'GF')!;
    expect(gf.homeSource).toBe('winner of WBR5P1');
    expect(gf.awaySource).toBe(`winner of LBR${b.lbRounds}P1`);
  });

  it('rejects a cutoff deeper than the bracket, or not a power of two', () => {
    expect(() => doubleElimBracket(8, { repechageEntrySize: 16 })).toThrow('<= bracketSize');
    expect(() => doubleElimBracket(16, { repechageEntrySize: 12 })).toThrow('power of 2');
  });
});

describe('secondChanceTarget: bronze', () => {
  const bronze = (n: number, extra = {}) =>
    doubleElimBracket(n, { secondChanceTarget: 'bronze', ...extra });

  it('emits no grand final — the WB final decides gold and silver', () => {
    const b = bronze(8);
    expect(b.slots.some((s) => s.section === 'GF')).toBe(false);
    expect(b.slots.some((s) => s.section === 'RESET')).toBe(false);
  });

  /**
   * Bronze mode is the gold ladder truncated by exactly one round: the WB
   * final's loser takes silver outright and never drops, so the last mixed
   * round disappears and the consolidation round before it becomes the bronze
   * match. The truncation always lands on a 1-match round.
   */
  it.each([
    [8, [2, 2, 1]],
    [16, [4, 4, 2, 2, 1]],
    [32, [8, 8, 4, 4, 2, 2, 1]],
  ])('%i-fighter bronze ladder is %j', (n, expected) => {
    expect(lbRoundSizes(bronze(n))).toEqual(expected);
  });

  it('never drops the winners-bracket final loser into the repechage', () => {
    for (const n of [8, 16, 32]) {
      const b = bronze(n);
      expect(wbDropRounds(b)).not.toContain(b.wbRounds);
      // ...but every earlier WB round still feeds it.
      expect(wbDropRounds(b)).toEqual(Array.from({ length: b.wbRounds - 1 }, (_, i) => i + 1));
    }
  });

  it('ends on a single bronze match', () => {
    const b = bronze(8);
    const last = b.slots.filter((s) => s.round === b.wbRounds + b.lbRounds);
    expect(last.length).toBe(1);
    // Consolidation round: both sides come from the previous LB round.
    expect(last[0]!.homeSource).toBe(`winner of LBR${b.lbRounds - 1}P1`);
    expect(last[0]!.awaySource).toBe(`winner of LBR${b.lbRounds - 1}P2`);
  });

  it('combines with a repechage cutoff', () => {
    const b = bronze(32, { repechageEntrySize: 8 });
    expect(lbRoundSizes(b)).toEqual([2, 2, 1]);
    expect(b.repechageEntryRound).toBe(3);
    // The WB final (round 5) still never drops; rounds 3-4 do.
    expect(wbDropRounds(b)).toEqual([3, 4]);
    expectRefsResolve(b);
  });

  it('rejects grandFinalReset — there is no grand final to reset', () => {
    expect(() => bronze(8, { grandFinalReset: true })).toThrow('no grand final');
  });

  it('rejects a field too small to leave any repechage rounds', () => {
    // bracketSize 2 → wbRounds 1: the WB final IS the whole bracket.
    expect(() => bronze(2)).toThrow('at least 4');
  });
});

describe('bronzeMatch: false', () => {
  const noBronze = (n: number, extra = {}) =>
    doubleElimBracket(n, { secondChanceTarget: 'bronze', bronzeMatch: false, ...extra });

  /**
   * Stops the repechage one round earlier still. The two survivors are ranked
   * 3rd/4th by pool score — the same rule single elimination already uses when
   * its bronze match is off. No place number is ever shared.
   */
  it.each([
    [8, [2, 2]],
    [16, [4, 4, 2, 2]],
    [32, [8, 8, 4, 4, 2, 2]],
  ])('%i-fighter no-bronze-match ladder is %j', (n, expected) => {
    expect(lbRoundSizes(noBronze(n))).toEqual(expected);
  });

  it('leaves exactly two unbeaten-in-the-LB survivors', () => {
    const b = noBronze(8);
    const lastRound = b.slots.filter((s) => s.round === b.wbRounds + b.lbRounds);
    expect(lastRound.length).toBe(2); // 2 matches → 2 winners → 3rd and 4th
    // Nothing consumes those winners, which is the point.
    const consumed = b.slots.flatMap((s) => [s.homeSource, s.awaySource]);
    for (const s of lastRound) {
      expect(consumed).not.toContain(`winner of LBR${b.lbRounds}P${s.position}`);
    }
  });

  it('is one round shorter than the same bracket with a bronze match', () => {
    for (const n of [8, 16, 32]) {
      expect(noBronze(n).lbRounds).toBe(
        doubleElimBracket(n, { secondChanceTarget: 'bronze' }).lbRounds - 1,
      );
    }
  });

  it('rejects a field too small to leave any repechage rounds', () => {
    expect(() => noBronze(4)).toThrow('at least 8');
    expect(() => noBronze(32, { repechageEntrySize: 8 })).not.toThrow();
  });

  it('is rejected in gold mode, where third place is already decided', () => {
    expect(() => doubleElimBracket(8, { bronzeMatch: false })).toThrow('does not apply');
    expect(() => doubleElimBracket(8, { bronzeMatch: true })).toThrow('does not apply');
    expect(() => doubleElimBracket(8, { secondChanceTarget: 'gold', bronzeMatch: true })).toThrow(
      'does not apply',
    );
  });
});

describe('match totals stay a closed form', () => {
  /**
   * `totalDoubleElimMatches` is deliberately arithmetic, not a slot count, so
   * it cross-checks the generator rather than restating it.
   */
  it('agrees with the generated slot count across every option combination', () => {
    const combos: Array<Parameters<typeof doubleElimBracket>[1]> = [
      {},
      { grandFinalReset: true },
      { repechageEntrySize: 8 },
      { repechageEntrySize: 16 },
      { repechageEntrySize: 8, grandFinalReset: true },
      { secondChanceTarget: 'bronze' },
      { secondChanceTarget: 'bronze', bronzeMatch: false },
      { secondChanceTarget: 'bronze', repechageEntrySize: 8 },
      { secondChanceTarget: 'bronze', bronzeMatch: false, repechageEntrySize: 8 },
    ];
    for (let n = 8; n <= 40; n++) {
      for (const opts of combos) {
        const size = doubleElimBracket(n).bracketSize;
        if ((opts?.repechageEntrySize ?? 2) > size) continue;
        expect(doubleElimBracket(n, opts).slots.length, `n=${n} ${JSON.stringify(opts)}`).toBe(
          totalDoubleElimMatches(n, opts),
        );
      }
    }
  });

  it('bronze mode trades the grand final for a shorter ladder', () => {
    // 8: gold = 7 WB + 6 LB + 1 GF = 14. Bronze drops the GF and one LB round.
    expect(totalDoubleElimMatches(8)).toBe(14);
    expect(totalDoubleElimMatches(8, { secondChanceTarget: 'bronze' })).toBe(12);
    expect(totalDoubleElimMatches(8, { secondChanceTarget: 'bronze', bronzeMatch: false })).toBe(
      11,
    );
  });

  it('a cutoff shrinks the repechage, not the winners bracket', () => {
    // 32-bracket: WB is 31 matches whatever the cutoff. LB is K-2, GF is 1.
    expect(totalDoubleElimMatches(32)).toBe(31 + 30 + 1);
    expect(totalDoubleElimMatches(32, { repechageEntrySize: 8 })).toBe(31 + 6 + 1);
    expect(totalDoubleElimMatches(32, { repechageEntrySize: 16 })).toBe(31 + 14 + 1);
  });
});
