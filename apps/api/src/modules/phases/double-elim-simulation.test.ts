import { describe, it, expect } from 'vitest';
import { doubleElimBracket, totalDoubleElimMatches } from '@myclash/rulesets/dist/scheduling/index';
import { buildSelfRef, grandFinalEndsBracket } from './bracket-refs';

/**
 * End-to-end double-elimination simulation.
 *
 * Drives a real generated bracket through the SAME ref-string matching
 * BracketAdvanceService uses — buildSelfRef to stamp a completed slot, then
 * `winner of {ref}` / `loser of {ref}` lookups to fill downstream slots. Unit
 * tests of the generator alone could not catch the bug this guards: the
 * bracket structure was internally consistent, but the LOSERS bracket
 * referenced `loser of WBR1Px` where Px was a bye — a match that never
 * happens. Nothing filled those slots, nothing advanced, and the tournament
 * stalled permanently after the winners bracket.
 */

interface SimSlot {
  round: number;
  position: number;
  homeSource: string;
  awaySource: string;
}

interface SimResult {
  champion: string;
  played: string[];
  unplayable: string[];
  eliminatedAtPlayIn: string[];
}

type Sides = Map<string, { a: string | null; b: string | null }>;

/** Seed every `seed N` source. Everything else fills by advancement. */
function seedSides(slots: SimSlot[], refOf: (s: SimSlot) => string): Sides {
  const read = (src: string) => {
    const m = /^seed (\d+)$/.exec(src);
    return m ? `F${m[1]}` : null;
  };
  const sides: Sides = new Map();
  for (const s of slots) sides.set(refOf(s), { a: read(s.homeSource), b: read(s.awaySource) });
  return sides;
}

/** Fill every downstream slot that names this one — the advance service's core. */
function propagate(
  slots: SimSlot[],
  refOf: (s: SimSlot) => string,
  sides: Sides,
  ref: string,
  winner: string,
  loser: string,
): void {
  for (const target of slots) {
    const t = sides.get(refOf(target))!;
    if (target.homeSource === `winner of ${ref}`) t.a = winner;
    if (target.awaySource === `winner of ${ref}`) t.b = winner;
    if (target.homeSource === `loser of ${ref}`) t.a = loser;
    if (target.awaySource === `loser of ${ref}`) t.b = loser;
  }
}

/**
 * Decide one match. The better seed wins, so results are deterministic —
 * except at the grand final, which a test can force the other way to exercise
 * the reset.
 */
function decide(cur: { a: string; b: string }, forceB: boolean): { winner: string; loser: string } {
  const seedOf = (name: string) => Number(name.slice(1));
  const winner = forceB || seedOf(cur.b) < seedOf(cur.a) ? cur.b : cur.a;
  return { winner, loser: winner === cur.a ? cur.b : cur.a };
}

interface PassContext {
  slots: SimSlot[];
  refOf: (s: SimSlot) => string;
  sides: Sides;
  config: { wbRounds: number; lbRounds: number; grandFinalReset: boolean };
  played: Set<string>;
  eliminatedAtPlayIn: string[];
  gfRound: number;
  titleRound: number;
  lbWinsGrandFinal: boolean;
}

/** One sweep: play every slot whose both sides are known, then propagate. */
function playPass(ctx: PassContext): { progressed: boolean; champion: string } {
  let progressed = false;
  let champion = '';
  for (const slot of ctx.slots) {
    const ref = ctx.refOf(slot);
    const cur = ctx.sides.get(ref)!;
    if (ctx.played.has(ref) || cur.a === null || cur.b === null) continue;

    const forceB = slot.round === ctx.gfRound && ctx.lbWinsGrandFinal;
    const { winner, loser } = decide({ a: cur.a, b: cur.b }, forceB);
    ctx.played.add(ref);
    progressed = true;
    if (slot.round === 0) ctx.eliminatedAtPlayIn.push(loser);
    if (slot.round === ctx.titleRound) champion = winner;

    // The grand final ends the bracket unless the losers-bracket entrant won.
    const slotRow = { round: slot.round, registration_a_id: cur.a };
    const ends = grandFinalEndsBracket('double_elim', ctx.config, slotRow, {
      winner_registration_id: winner,
    });
    if (ends) {
      champion = winner;
      continue;
    }
    propagate(ctx.slots, ctx.refOf, ctx.sides, ref, winner, loser);
  }
  return { progressed, champion };
}

/**
 * Play a whole bracket. The better seed always wins, so results are
 * deterministic and the champion is seed 1.
 */
function simulate(
  fighterCount: number,
  grandFinalReset: boolean,
  /** Force the losers-bracket entrant (side B) to win the grand final. */
  lbWinsGrandFinal = false,
): SimResult {
  const bracket = doubleElimBracket(fighterCount, { grandFinalReset });
  const config = { wbRounds: bracket.wbRounds, lbRounds: bracket.lbRounds, grandFinalReset };
  const slots = bracket.slots as SimSlot[];
  const refOf = (s: SimSlot) => buildSelfRef(s.round, s.position, 'double_elim', config);
  const gfRound = bracket.wbRounds + bracket.lbRounds + 1;

  const ctx: PassContext = {
    slots,
    refOf,
    sides: seedSides(slots, refOf),
    config,
    played: new Set<string>(),
    eliminatedAtPlayIn: [],
    gfRound,
    titleRound: gfRound + (grandFinalReset ? 1 : 0),
    lbWinsGrandFinal,
  };

  // Fixed-point loop: play whatever is ready, propagate, repeat.
  let champion = '';
  for (let guard = 0; guard < slots.length + 5; guard++) {
    const pass = playPass(ctx);
    if (pass.champion) champion = pass.champion;
    if (!pass.progressed) break;
  }

  return {
    champion,
    played: [...ctx.played],
    unplayable: slots.map(refOf).filter((r) => !ctx.played.has(r)),
    eliminatedAtPlayIn: ctx.eliminatedAtPlayIn,
  };
}

describe('double-elim end-to-end simulation', () => {
  /**
   * The regression. Before the play-in model, 12 fighters padded to a
   * 16-bracket with 4 byes and EVERY losers-round-1 slot waited forever on a
   * loser that would never exist.
   */
  it('plays a 12-fighter bracket to completion with nothing left stalled', () => {
    const { champion, unplayable } = simulate(12, false);
    expect(unplayable).toEqual([]);
    expect(champion).toBe('F1');
  });

  it.each([5, 6, 7, 11, 12, 13, 23, 31])(
    'never stalls at %i fighters (non-power-of-two fields)',
    (n) => {
      expect(simulate(n, false).unplayable).toEqual([]);
    },
  );

  it.each([2, 4, 8, 16, 32])('never stalls at %i fighters (exact powers of two)', (n) => {
    expect(simulate(n, false).unplayable).toEqual([]);
  });

  it('plays exactly the number of matches the generator promises', () => {
    for (const n of [8, 12, 23]) {
      expect(simulate(n, false).played.length).toBe(totalDoubleElimMatches(n));
    }
  });

  it('eliminates play-in losers and never routes them into the losers bracket', () => {
    // 12 fighters → 4 play-in matches → 4 fighters out after ONE loss.
    const { eliminatedAtPlayIn, played } = simulate(12, false);
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
      const { champion, unplayable, played } = simulate(8, true);
      expect(champion).toBe('F1');
      expect(played).toContain('GF');
      // The reset is the ONLY thing left unplayed, by design.
      expect(unplayable).toEqual(['GFRESET']);
    });

    it('still counts every other match as played', () => {
      const { played } = simulate(8, true);
      expect(played.length).toBe(totalDoubleElimMatches(8, { grandFinalReset: true }) - 1);
    });

    /**
     * The other half of the rule: the losers-bracket entrant arrives with one
     * loss, so beating the unbeaten winners-bracket entrant once only levels
     * the tie — the reset MUST be played, and it decides the title.
     */
    it('plays the reset when the losers-bracket entrant wins the grand final', () => {
      const { champion, unplayable, played } = simulate(8, true, true);
      expect(unplayable).toEqual([]);
      expect(played).toContain('GFRESET');
      expect(played.length).toBe(totalDoubleElimMatches(8, { grandFinalReset: true }));
      // The reset decides it, so the champion is NOT simply the best seed.
      expect(champion).not.toBe('');
    });

    it('has no reset to play when the option is off', () => {
      const { unplayable, played } = simulate(8, false, true);
      expect(unplayable).toEqual([]);
      expect(played).not.toContain('GFRESET');
    });
  });
});
