/**
 * Shared vocabulary for final-ranking computation: the slot/entry shapes, the
 * winner-resolution rule, and the accumulator that assigns place numbers.
 *
 * Split out of `final-ranking.ts` so the single-elim and double-elim orderings
 * can each live in a readable module while provably sharing one definition of
 * "who won" and one place counter. Re-exported from `final-ranking.ts`, which
 * stays the public entry point.
 *
 * Pure: no React, no I/O.
 */

export interface RankingSlot {
  id: string;
  round: number;
  position: number;
  status: string;
  redRegistrationId: string | null;
  blueRegistrationId: string | null;
  redFighterName: string | null;
  blueFighterName: string | null;
  redClubAbbrev?: string | null;
  blueClubAbbrev?: string | null;
  redScore: number | null;
  blueScore: number | null;
  /** Recorded match winner (matches.winner_registration_id) — authoritative
   *  over score comparison; forfeits can award the lower-scored fighter. */
  winnerRegistrationId?: string | null;
}

/** A pool-phase fighter (every registration that competed in the pools). */
export interface PoolEntry {
  registrationId: string;
  fighterName: string;
  clubAbbrev: string | null;
  poolScore: number | null;
}

/** Which podium model a double-elim bracket uses. */
export type SecondChanceTarget = 'gold' | 'bronze';

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

export type FinalRankingResultKind =
  | 'champion'
  | 'runnerUp'
  | 'third'
  | 'fourth'
  | 'round'
  | 'pool'
  /**
   * Placed by the Swiss standings rather than by a bracket result. Distinct
   * from 'pool' because that kind means "never reached the bracket" and sorts
   * strictly below every bracket entrant — a Swiss fighter placed 5th was not
   * eliminated from anything.
   */
  | 'swiss';

/** Which part of a double-elim bracket a fighter was eliminated in. */
export type FinalRankingBracketSection = 'WB' | 'LB' | 'PLAYIN';

export interface FinalRankingEntry {
  place: number;
  registrationId: string;
  fighterName: string;
  clubAbbrev: string | null;
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

export interface Side {
  registrationId: string;
  fighterName: string;
  clubAbbrev: string | null;
}

export function winnerLoser(slot: RankingSlot): { winner: Side; loser: Side } | null {
  if (slot.status !== 'completed') return null;
  if (
    !slot.redRegistrationId ||
    !slot.blueRegistrationId ||
    !slot.redFighterName ||
    !slot.blueFighterName
  ) {
    return null;
  }
  const red: Side = {
    registrationId: slot.redRegistrationId,
    fighterName: slot.redFighterName,
    clubAbbrev: slot.redClubAbbrev ?? null,
  };
  const blue: Side = {
    registrationId: slot.blueRegistrationId,
    fighterName: slot.blueFighterName,
    clubAbbrev: slot.blueClubAbbrev ?? null,
  };
  // Recorded winner first: a keep-current forfeit stores the pre-forfeit score
  // (possibly favouring the forfeiter, or 0-0) with the OPPONENT as winner.
  if (slot.winnerRegistrationId === red.registrationId) return { winner: red, loser: blue };
  if (slot.winnerRegistrationId === blue.registrationId) return { winner: blue, loser: red };
  if (slot.redScore === null || slot.blueScore === null || slot.redScore === slot.blueScore) {
    return null;
  }
  return slot.redScore > slot.blueScore
    ? { winner: red, loser: blue }
    : { winner: blue, loser: red };
}

/** Shared accumulator: assigns place numbers and dedupes by registration. */
export class Ranking {
  readonly entries: FinalRankingEntry[] = [];
  private readonly placed = new Set<string>();
  private readonly poolScoreByReg = new Map<string, number>();

  constructor(poolEntries: PoolEntry[]) {
    for (const e of poolEntries) {
      if (e.poolScore !== null && Number.isFinite(e.poolScore)) {
        this.poolScoreByReg.set(e.registrationId, e.poolScore);
      }
    }
  }

  poolScoreOf(regId: string): number | null {
    return this.poolScoreByReg.get(regId) ?? null;
  }

  has(regId: string): boolean {
    return this.placed.has(regId);
  }

  push(
    side: Side,
    resultKind: FinalRankingResultKind,
    extra: Pick<FinalRankingEntry, 'eliminationRound' | 'bracketSection'> = {},
  ): void {
    if (this.placed.has(side.registrationId)) return;
    this.entries.push({
      place: this.entries.length + 1,
      registrationId: side.registrationId,
      fighterName: side.fighterName,
      clubAbbrev: side.clubAbbrev,
      poolScore: this.poolScoreOf(side.registrationId),
      resultKind,
      ...(extra.eliminationRound !== undefined ? { eliminationRound: extra.eliminationRound } : {}),
      ...(extra.bracketSection !== undefined ? { bracketSection: extra.bracketSection } : {}),
    });
    this.placed.add(side.registrationId);
  }

  /** Deepest-first within a round: pool score descending, name as tiebreak. */
  byPoolScore = (a: Side | PoolEntry, b: Side | PoolEntry): number => {
    const na = this.poolScoreOf(a.registrationId) ?? Number.NEGATIVE_INFINITY;
    const nb = this.poolScoreOf(b.registrationId) ?? Number.NEGATIVE_INFINITY;
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
    if (!wl || r.has(wl.loser.registrationId)) continue;
    const group = out.get(slot.round) ?? [];
    group.push(wl.loser);
    out.set(slot.round, group);
  }
  return out;
}
