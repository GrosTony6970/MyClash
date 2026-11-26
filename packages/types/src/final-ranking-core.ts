/**
 * Shared vocabulary for final-ranking computation: the slot/entry shapes, the
 * winner-resolution rule, and the accumulator that assigns place numbers.
 *
 * Split out of `final-ranking.ts` so the single-elim and double-elim orderings
 * can each live in a readable module while provably sharing one definition of
 * "who won" and one place counter. Re-exported from `final-ranking.ts`, which
 * stays the public entry point.
 *
 * A side is a Fighter's Registration or a team (ADR-022): every key here is a side key
 * (`sideKey`), the Registration id or the team id, so a team bracket ranks its teams.
 *
 * Pure: no React, no I/O.
 */

import type { BracketSideWire, BracketSlotWire } from './bracket-side';

/**
 * A bracket slot as the ranking reads it: the fields of the slot both bracket reads send
 * (`BracketSlotWire`), so a field renamed on the wire is a compile error here. `winnerSideId` is
 * the recorded winner, authoritative over the scores: a forfeit can award the lower score.
 */
export type RankingSlot = Pick<
  BracketSlotWire,
  | 'id'
  | 'round'
  | 'position'
  | 'status'
  | 'redSideId'
  | 'blueSideId'
  | 'winnerSideId'
  | 'red'
  | 'blue'
  | 'redScore'
  | 'blueScore'
>;

/** An entrant of the pools (every Fighter or team that competed in them). */
export interface PoolEntry {
  /** The side key (`sideKey`): the Registration id, or the team id. */
  entrantId: string;
  kind: BracketSideWire['kind'];
  /** The side's label: the Fighter's name, or the team's. */
  fighterName: string;
  clubAbbrev: string | null;
  /** A team's colour name (`TOURNAMENT_COLORS`), or none. A Fighter has no colour. */
  colour: string | null;
  poolScore: number | null;
}

/**
 * Which podium model a double-elim bracket uses, and how a fighter's placing
 * was arrived at. Both are implemented in `@myclash/rules`: the bracket
 * generator there emits the shape these read, and this module used to declare
 * its own copy of each.
 */
export type { FinalRankingResultKind, SecondChanceTarget } from '@myclash/rules/pad';
import type { FinalRankingResultKind, SecondChanceTarget } from '@myclash/rules/pad';

/**
 * Bracket shape, needed to read a double-elim bracket's round numbering.
 * Omit it (or pass single_elim) for the single-elimination ordering.
 */
export interface RankingBracketShape {
  /**
   * `swiss` is not a bracket shape — it is the absence of one. A Swiss phase
   * decides its podium from the standings, so `computeFinalRanking` takes a
   * third branch rather than reading slots. It belongs in this union because
   * every caller derives the value from `phases.type` and the alternative was
   * coercing it to `single_elim`, which silently produced a bracket ordering
   * for a phase with no bracket.
   */
  phaseType: 'single_elim' | 'double_elim' | 'swiss';
  wbRounds?: number | null;
  lbRounds?: number | null;
  /**
   * 'gold' (default): the losers bracket plays into a grand final and its
   * winner can take the title. 'bronze': the winners-bracket final decides
   * gold and silver by itself and the repechage plays for third.
   */
  secondChanceTarget?: SecondChanceTarget | null;
  /**
   * Bronze mode only. When false the repechage stops one round early and the
   * two survivors are separated by pool score instead of playing.
   */
  bronzeMatch?: boolean | null;
  /**
   * First winners-bracket round whose losers drop into the repechage.
   * 1 (or omitted) means everyone gets a second chance; anything higher means
   * losers of the rounds BEFORE it are eliminated on a single loss.
   */
  repechageEntryRound?: number | null;
}

/** Which part of a double-elim bracket a fighter was eliminated in. */
export type FinalRankingBracketSection = 'WB' | 'LB' | 'PLAYIN';

export interface FinalRankingEntry {
  place: number;
  /** The side key (`sideKey`): the Registration id, or the team id. */
  entrantId: string;
  kind: BracketSideWire['kind'];
  /** The side's label: the Fighter's name, or the team's. */
  fighterName: string;
  clubAbbrev: string | null;
  colour: string | null;
  poolScore: number | null;
  resultKind: FinalRankingResultKind;
  /** Bracket round the fighter was eliminated in — only when resultKind === 'round'.
   *  Single-elim: the absolute round. Double-elim: the LB-RELATIVE round (1 =
   *  the first losers round) for an LB exit, the absolute WB round for a
   *  pre-cutoff WB exit, or 0 for a play-in loser. */
  eliminationRound?: number;
  /** Only set for double-elim, so surfaces can label "Losers R3" rather than
   *  printing a meaningless absolute round number. */
  bracketSection?: FinalRankingBracketSection;
}

/** One ranked side: what a ranking entry says of the Fighter or the team. */
export type Side = Pick<PoolEntry, 'entrantId' | 'kind' | 'fighterName' | 'clubAbbrev' | 'colour'>;

/** A side of a slot that can be ranked: filled and named, else null. */
function rankedSide(side: BracketSideWire | null): Side | null {
  if (!side?.name) return null;
  return {
    entrantId: side.sideId,
    kind: side.kind,
    fighterName: side.name,
    clubAbbrev: side.clubAbbrev,
    colour: side.colour,
  };
}

export function winnerLoser(slot: RankingSlot): { winner: Side; loser: Side } | null {
  if (slot.status !== 'completed') return null;
  const red = rankedSide(slot.red);
  const blue = rankedSide(slot.blue);
  if (!red || !blue) return null;
  // Recorded winner first: a keep-current forfeit stores the pre-forfeit score
  // (possibly favouring the forfeiter, or 0-0) with the OPPONENT as winner.
  if (slot.winnerSideId === red.entrantId) return { winner: red, loser: blue };
  if (slot.winnerSideId === blue.entrantId) return { winner: blue, loser: red };
  if (slot.redScore === null || slot.blueScore === null || slot.redScore === slot.blueScore) {
    return null;
  }
  return slot.redScore > slot.blueScore
    ? { winner: red, loser: blue }
    : { winner: blue, loser: red };
}

/** Shared accumulator: assigns place numbers and dedupes by side key. */
export class Ranking {
  readonly entries: FinalRankingEntry[] = [];
  private readonly placed = new Set<string>();
  private readonly poolScoreByEntrant = new Map<string, number>();

  constructor(poolEntries: PoolEntry[]) {
    for (const e of poolEntries) {
      if (e.poolScore !== null && Number.isFinite(e.poolScore)) {
        this.poolScoreByEntrant.set(e.entrantId, e.poolScore);
      }
    }
  }

  poolScoreOf(entrantId: string): number | null {
    return this.poolScoreByEntrant.get(entrantId) ?? null;
  }

  has(entrantId: string): boolean {
    return this.placed.has(entrantId);
  }

  push(
    side: Side,
    resultKind: FinalRankingResultKind,
    extra: Pick<FinalRankingEntry, 'eliminationRound' | 'bracketSection'> = {},
  ): void {
    if (this.placed.has(side.entrantId)) return;
    this.entries.push({
      place: this.entries.length + 1,
      entrantId: side.entrantId,
      kind: side.kind,
      fighterName: side.fighterName,
      clubAbbrev: side.clubAbbrev,
      colour: side.colour,
      poolScore: this.poolScoreOf(side.entrantId),
      resultKind,
      ...(extra.eliminationRound !== undefined ? { eliminationRound: extra.eliminationRound } : {}),
      ...(extra.bracketSection !== undefined ? { bracketSection: extra.bracketSection } : {}),
    });
    this.placed.add(side.entrantId);
  }

  /** Deepest-first within a round: pool score descending, name as tiebreak. */
  byPoolScore = (a: Side, b: Side): number => {
    const na = this.poolScoreOf(a.entrantId) ?? Number.NEGATIVE_INFINITY;
    const nb = this.poolScoreOf(b.entrantId) ?? Number.NEGATIVE_INFINITY;
    if (nb !== na) return nb - na;
    return a.fighterName.localeCompare(b.fighterName);
  };

  /**
   * Push one round's worth of losers. `podiumKinds` lets double-elim mark the
   * LB-final and LB-semi losers as 3rd/4th, which is what those placings are.
   */
  pushRound(
    losers: Side[],
    extra: Pick<FinalRankingEntry, 'eliminationRound' | 'bracketSection'>,
    podiumKinds = false,
  ): void {
    for (const side of [...losers].sort(this.byPoolScore)) {
      const nextPlace = this.entries.length + 1;
      const kind: FinalRankingResultKind =
        podiumKinds && nextPlace === 3
          ? 'third'
          : podiumKinds && nextPlace === 4
            ? 'fourth'
            : 'round';
      this.push(side, kind, extra);
    }
  }
}

/** Losers of every completed slot in `slots`, keyed by round. */
export function losersByRound(slots: RankingSlot[], r: Ranking): Map<number, Side[]> {
  const out = new Map<number, Side[]>();
  for (const slot of slots) {
    const wl = winnerLoser(slot);
    if (!wl || r.has(wl.loser.entrantId)) continue;
    const group = out.get(slot.round) ?? [];
    group.push(wl.loser);
    out.set(slot.round, group);
  }
  return out;
}
