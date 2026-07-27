import { describe, it, expect } from 'vitest';
import { totalDoubleElimMatches } from '@myclash/rulesets/dist/scheduling/index';
import { rankSimulation, simulate } from './double-elim-simulation.harness';

/**
 * End-to-end double-elimination simulation — the test shape that actually
 * matters for this format. See `double-elim-simulation.harness.ts` for why
 * generator unit tests cannot substitute: a bracket can be internally
 * consistent and still deadlock, or complete and still rank nobody.
 */

describe('double-elim end-to-end simulation', () => {
  /**
   * The Slice 1 regression. Before the play-in model, 12 fighters padded to a
   * 16-bracket with 4 byes and EVERY losers-round-1 slot waited forever on a
   * loser that would never exist.
   */
  it('plays a 12-fighter bracket to completion with nothing left stalled', () => {
    const { champion, unplayable } = simulate(12);
    expect(unplayable).toEqual([]);
    expect(champion).toBe('F1');
  });

  it.each([5, 6, 7, 11, 12, 13, 23, 31])(
    'never stalls at %i fighters (non-power-of-two fields)',
    (n) => {
      expect(simulate(n).unplayable).toEqual([]);
    },
  );

  it.each([2, 4, 8, 16, 32])('never stalls at %i fighters (exact powers of two)', (n) => {
    expect(simulate(n).unplayable).toEqual([]);
  });

  it('plays exactly the number of matches the generator promises', () => {
    for (const n of [8, 12, 23]) {
      expect(simulate(n).played.length).toBe(totalDoubleElimMatches(n));
    }
  });

  it('eliminates play-in losers and never routes them into the losers bracket', () => {
    // 12 fighters → 4 play-in matches → 4 fighters out after ONE loss.
    const { eliminatedAtPlayIn, played } = simulate(12);
    expect(eliminatedAtPlayIn.length).toBe(4);
    expect(played.filter((r) => r.startsWith('WBR0')).length).toBe(4);
  });

  describe('grand final reset', () => {
    /**
     * With the better seed always winning, the winners-bracket entrant takes
     * the grand final — so the reset must be SKIPPED. Leaving it live would
     * put an unplayable match on the schedule and, because the reset sits at
     * the bracket's highest round, leave the tournament permanently undecided.
     */
    it('skips the reset when the winners-bracket entrant wins', () => {
      const { champion, unplayable, played } = simulate(8, { grandFinalReset: true });
      expect(champion).toBe('F1');
      expect(played).toContain('GF');
      // The reset is the ONLY thing left unplayed, by design.
      expect(unplayable).toEqual(['GFRESET']);
    });

    it('still counts every other match as played', () => {
      const { played } = simulate(8, { grandFinalReset: true });
      expect(played.length).toBe(totalDoubleElimMatches(8, { grandFinalReset: true }) - 1);
    });

    /**
     * The other half of the rule: the losers-bracket entrant arrives with one
     * loss, so beating the unbeaten winners-bracket entrant once only levels
     * the tie — the reset MUST be played, and it decides the title.
     */
    it('plays the reset when the losers-bracket entrant wins the grand final', () => {
      const { champion, unplayable, played } = simulate(8, {
        grandFinalReset: true,
        lbWinsGrandFinal: true,
      });
      expect(unplayable).toEqual([]);
      expect(played).toContain('GFRESET');
      expect(played.length).toBe(totalDoubleElimMatches(8, { grandFinalReset: true }));
      // The reset decides it, so the champion is NOT simply the best seed.
      expect(champion).not.toBe('');
    });

    it('has no reset to play when the option is off', () => {
      const { unplayable, played } = simulate(8, { lbWinsGrandFinal: true });
      expect(unplayable).toEqual([]);
      expect(played).not.toContain('GFRESET');
    });
  });
});

// ── Slice 2: podium options and repechage cutoffs ────────────────────────────

/** Every option combination an organiser can actually pick, for sweep tests. */
const CONFIGS = [
  { label: 'classical', opts: {} },
  { label: 'classical + reset', opts: { grandFinalReset: true } },
  { label: 'last 8', opts: { repechageEntrySize: 8 } },
  { label: 'last 8 + reset', opts: { repechageEntrySize: 8, grandFinalReset: true } },
  { label: 'last 16', opts: { repechageEntrySize: 16 } },
  { label: 'bronze', opts: { secondChanceTarget: 'bronze' as const } },
  {
    label: 'bronze, no bronze match',
    opts: { secondChanceTarget: 'bronze' as const, bronzeMatch: false },
  },
  {
    label: 'bronze + last 8',
    opts: { secondChanceTarget: 'bronze' as const, repechageEntrySize: 8 },
  },
] as const;

/** Field sizes big enough for every config above (needs bracketSize >= 16). */
const FIELDS = [16, 17, 23, 31, 32, 33];

describe('double-elim simulation — podium options', () => {
  for (const { label, opts } of CONFIGS) {
    describe(label, () => {
      it.each(FIELDS)('never stalls at %i fighters', (n) => {
        const { unplayable } = simulate(n, opts);
        // A reset that was correctly skipped is the one legitimate leftover.
        expect(unplayable.filter((r) => r !== 'GFRESET')).toEqual([]);
      });

      it.each(FIELDS)('produces a complete, strictly-ordered ranking at %i', (n) => {
        const result = simulate(n, opts);
        const ranking = rankSimulation(result);

        // Every fighter who entered the bracket gets exactly one unique place.
        expect(ranking.length).toBe(n);
        expect(ranking.map((e) => e.place)).toEqual(Array.from({ length: n }, (_, i) => i + 1));
        expect(new Set(ranking.map((e) => e.registrationId)).size).toBe(n);
      });

      it.each(FIELDS)('crowns the top seed at %i', (n) => {
        // The better seed always wins, so seed 1 must take the title in every
        // configuration — including bronze mode, where the WB final decides it.
        expect(rankSimulation(simulate(n, opts))[0]?.registrationId).toBe('F1');
      });
    });
  }

  it('plays exactly the promised match count in every configuration', () => {
    for (const { label, opts } of CONFIGS) {
      for (const n of FIELDS) {
        const { played, unplayable } = simulate(n, opts);
        // The top seed wins every match, so an enabled reset is never needed.
        // That skipped reset is the ONLY match the generator promises and the
        // simulation legitimately leaves unplayed.
        const skippedReset = unplayable.length;
        expect(
          unplayable.every((r) => r === 'GFRESET'),
          `${label} @ ${n}`,
        ).toBe(true);
        expect(played.length, `${label} @ ${n}`).toBe(
          totalDoubleElimMatches(n, opts) - skippedReset,
        );
      }
    }
  });
});

describe('bronze mode end to end', () => {
  it('never creates a grand final — the WB final is the gold medal match', () => {
    const { played, bracket } = simulate(16, { secondChanceTarget: 'bronze' });
    expect(played).not.toContain('GF');
    expect(played).not.toContain('GFRESET');
    expect(played).toContain(`WBR${bracket.wbRounds}P1`);
  });

  it('gives silver to the WB-final loser without them playing again', () => {
    const result = simulate(16, { secondChanceTarget: 'bronze' });
    const ranking = rankSimulation(result);
    const silver = ranking[1]!.registrationId;
    // The runner-up appears in the winners bracket and nowhere in the losers
    // bracket: they took silver outright rather than dropping.
    const lbAppearances = result.rankingSlots.filter(
      (s) =>
        s.round > result.bracket.wbRounds &&
        (s.redRegistrationId === silver || s.blueRegistrationId === silver),
    );
    expect(lbAppearances).toEqual([]);
  });

  it('decides bronze in a real match when bronzeMatch is on', () => {
    const result = simulate(16, { secondChanceTarget: 'bronze' });
    const lastRound = result.bracket.wbRounds + result.bracket.lbRounds;
    const bronzeSlot = result.rankingSlots.filter((s) => s.round === lastRound);
    expect(bronzeSlot.length).toBe(1);
    expect(bronzeSlot[0]!.status).toBe('completed');

    const ranking = rankSimulation(result);
    expect(ranking[2]!.registrationId).toBe(bronzeSlot[0]!.winnerRegistrationId);
    expect(ranking[2]!.resultKind).toBe('third');
    expect(ranking[3]!.resultKind).toBe('fourth');
  });

  it('separates the two survivors by tiebreak when bronzeMatch is off', () => {
    const result = simulate(16, { secondChanceTarget: 'bronze', bronzeMatch: false });
    const lastRound = result.bracket.wbRounds + result.bracket.lbRounds;
    const survivors = result.rankingSlots
      .filter((s) => s.round === lastRound)
      .map((s) => s.winnerRegistrationId);
    expect(survivors.length).toBe(2);

    const ranking = rankSimulation(result);
    // 3rd and 4th are exactly the two unbeaten-in-the-repechage fighters, and
    // they are distinct places — never a shared bronze.
    expect([ranking[2]!.registrationId, ranking[3]!.registrationId].sort()).toEqual(
      [...survivors].sort(),
    );
    expect(ranking[2]!.place).toBe(3);
    expect(ranking[3]!.place).toBe(4);
  });
});

describe('repechage cutoff end to end', () => {
  it('eliminates pre-cutoff winners-bracket losers on a single loss', () => {
    // 32-bracket, last 8 → WB rounds 1 and 2 are sudden death.
    const result = simulate(32, { repechageEntrySize: 8 });
    expect(result.bracket.repechageEntryRound).toBe(3);
    const ranking = rankSimulation(result);

    const preCutoff = ranking.filter((e) => e.bracketSection === 'WB');
    // 16 knocked out in WB R1 + 8 in WB R2.
    expect(preCutoff.length).toBe(24);
    expect(new Set(preCutoff.map((e) => e.eliminationRound))).toEqual(new Set([1, 2]));
  });

  it('ranks every repechage exit above every pre-cutoff exit', () => {
    const ranking = rankSimulation(simulate(32, { repechageEntrySize: 8 }));
    const lastLb = Math.max(
      ...ranking.filter((e) => e.bracketSection === 'LB').map((e) => e.place),
    );
    const firstWb = Math.min(
      ...ranking.filter((e) => e.bracketSection === 'WB').map((e) => e.place),
    );
    expect(lastLb).toBeLessThan(firstWb);
  });

  it('orders pre-cutoff losers by winners-bracket depth, deepest first', () => {
    const ranking = rankSimulation(simulate(32, { repechageEntrySize: 8 }));
    const wb = ranking.filter((e) => e.bracketSection === 'WB');
    const rounds = wb.map((e) => e.eliminationRound!);
    // Round 2 exits (reached the round of 16) all precede round 1 exits.
    expect(rounds).toEqual([...rounds].sort((a, b) => b - a));
  });

  it('sends exactly K-1 fighters into a cutoff repechage', () => {
    // A cutoff of 8 takes 8/2 + 8/4 + 8/8 = 7 entrants, exactly an 8-bracket's
    // losers intake. Six are eliminated there; the seventh wins it and reaches
    // the grand final.
    const result = simulate(32, { repechageEntrySize: 8 });
    const ranking = rankSimulation(result);
    expect(ranking.filter((e) => e.bracketSection === 'LB').length).toBe(6);

    // The runner-up is the repechage survivor, so they must actually appear in
    // a losers-bracket slot — otherwise the seventh entrant is unaccounted for.
    const runnerUp = ranking[1]!.registrationId;
    const inLosersBracket = result.rankingSlots.some(
      (s) =>
        s.round > result.bracket.wbRounds &&
        s.round <= result.bracket.wbRounds + result.bracket.lbRounds &&
        (s.redRegistrationId === runnerUp || s.blueRegistrationId === runnerUp),
    );
    expect(inLosersBracket).toBe(true);
  });

  it('keeps the play-in below everything, even with a cutoff', () => {
    const ranking = rankSimulation(simulate(33, { repechageEntrySize: 8 }));
    const playIn = ranking.filter((e) => e.bracketSection === 'PLAYIN');
    expect(playIn.length).toBe(1);
    expect(playIn[0]!.place).toBe(33);
  });
});
