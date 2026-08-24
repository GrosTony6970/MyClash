/**
 * Simulation engine for the double-elimination end-to-end tests.
 *
 * Drives a real generated bracket through the SAME ref-string matching
 * BracketAdvanceService uses — `buildSelfRef` to stamp a completed slot, then
 * `winner of {ref}` / `loser of {ref}` lookups to fill downstream slots — and
 * then feeds the finished bracket into the SAME `computeFinalRanking` every
 * surface reads.
 *
 * Generator unit tests cannot catch what this catches. Slice 1's deadlock had
 * a perfectly self-consistent bracket structure whose losers bracket
 * referenced `loser of WBR1Px` where Px was a bye — a match that never
 * happens. Nothing filled those slots, nothing advanced, and the tournament
 * stalled permanently. The same class of bug hides in every new podium option:
 * a truncated ladder that leaves a slot nothing will ever fill, or a bracket
 * that completes but produces an empty ranking.
 *
 * Lives beside the test rather than inside it so both the classical and the
 * Slice 2 option suites share one engine, and so neither file has to carry
 * ~150 lines of harness before its first assertion.
 */

import {
  doubleElimBracket,
  type DoubleElimBracket,
  type DoubleElimOptions,
} from '@myclash/rules/scheduling';
import {
  computeFinalRanking,
  type FinalRankingEntry,
  type RankingBracketShape,
  type RankingSlot,
} from '@myclash/types';
import { buildSelfRef, grandFinalEndsBracket } from './bracket-refs';

interface SimSlot {
  round: number;
  position: number;
  homeSource: string;
  awaySource: string;
}

type Sides = Map<string, { a: string | null; b: string | null }>;
type Results = Map<string, { winner: string; loser: string }>;

export interface SimOptions extends DoubleElimOptions {
  /** Force the second-chance entrant (side B) to win the grand final. */
  lbWinsGrandFinal?: boolean;
}

export interface SimResult {
  bracket: DoubleElimBracket;
  champion: string;
  played: string[];
  unplayable: string[];
  eliminatedAtPlayIn: string[];
  /** Every slot as `computeFinalRanking` sees it, played or not. */
  rankingSlots: RankingSlot[];
  shape: RankingBracketShape;
}

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
  results: Results;
  config: { wbRounds: number; lbRounds: number; grandFinalReset: boolean };
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
    if (ctx.results.has(ref) || cur.a === null || cur.b === null) continue;

    const forceB = slot.round === ctx.gfRound && ctx.lbWinsGrandFinal;
    const { winner, loser } = decide({ a: cur.a, b: cur.b }, forceB);
    ctx.results.set(ref, { winner, loser });
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

/** Project the simulated bracket into the rows `computeFinalRanking` reads. */
function toRankingSlots(
  slots: SimSlot[],
  refOf: (s: SimSlot) => string,
  sides: Sides,
  results: Results,
): RankingSlot[] {
  return slots.map((s) => {
    const ref = refOf(s);
    const cur = sides.get(ref)!;
    const res = results.get(ref) ?? null;
    return {
      id: ref,
      round: s.round,
      position: s.position,
      status: res ? 'completed' : 'scheduled',
      redRegistrationId: cur.a,
      blueRegistrationId: cur.b,
      redFighterName: cur.a,
      blueFighterName: cur.b,
      redClubAbbrev: null,
      blueClubAbbrev: null,
      redScore: res ? (res.winner === cur.a ? 5 : 3) : null,
      blueScore: res ? (res.winner === cur.b ? 5 : 3) : null,
      winnerRegistrationId: res?.winner ?? null,
    };
  });
}

/** Wire up the pass context for one generated bracket. */
function buildContext(bracket: DoubleElimBracket, lbWinsGrandFinal: boolean): PassContext {
  const config = {
    wbRounds: bracket.wbRounds,
    lbRounds: bracket.lbRounds,
    grandFinalReset: bracket.grandFinalReset,
  };
  const slots = bracket.slots as SimSlot[];
  const refOf = (s: SimSlot) => buildSelfRef(s.round, s.position, 'double_elim', config);
  const gfRound = bracket.wbRounds + bracket.lbRounds + 1;

  return {
    slots,
    refOf,
    sides: seedSides(slots, refOf),
    results: new Map(),
    config,
    eliminatedAtPlayIn: [],
    gfRound,
    // Bronze mode has no grand final: the winners-bracket final takes the title.
    titleRound:
      bracket.secondChanceTarget === 'bronze'
        ? bracket.wbRounds
        : gfRound + (bracket.grandFinalReset ? 1 : 0),
    lbWinsGrandFinal,
  };
}

/**
 * Play a whole bracket. The better seed always wins, so results are
 * deterministic and the champion is seed 1 (unless a test forces the grand
 * final the other way).
 */
export function simulate(fighterCount: number, options: SimOptions = {}): SimResult {
  const { lbWinsGrandFinal = false, ...generatorOptions } = options;
  const bracket = doubleElimBracket(fighterCount, generatorOptions);
  const ctx = buildContext(bracket, lbWinsGrandFinal);

  // Fixed-point loop: play whatever is ready, propagate, repeat.
  let champion = '';
  for (let guard = 0; guard < ctx.slots.length + 5; guard++) {
    const pass = playPass(ctx);
    if (pass.champion) champion = pass.champion;
    if (!pass.progressed) break;
  }

  return {
    bracket,
    champion,
    played: [...ctx.results.keys()],
    unplayable: ctx.slots.map(ctx.refOf).filter((r) => !ctx.results.has(r)),
    eliminatedAtPlayIn: ctx.eliminatedAtPlayIn,
    rankingSlots: toRankingSlots(ctx.slots, ctx.refOf, ctx.sides, ctx.results),
    shape: {
      phaseType: 'double_elim',
      wbRounds: bracket.wbRounds,
      lbRounds: bracket.lbRounds,
      secondChanceTarget: bracket.secondChanceTarget,
      bronzeMatch: bracket.bronzeMatch,
      repechageEntryRound: bracket.repechageEntryRound,
    },
  };
}

/** Rank a simulated bracket exactly as every product surface would. */
export function rankSimulation(result: SimResult): FinalRankingEntry[] {
  return computeFinalRanking(result.rankingSlots, [], null, result.shape);
}
