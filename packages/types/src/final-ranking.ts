/**
 * Final-ranking computation for an elimination bracket — shared by the admin
 * Final ranking page, the public tournament page, and the API (fighter career
 * placements, league standings) so every surface renders the exact same order.
 * Adds a pool-score tiebreak, and a tail of everyone who competed in the pools
 * but didn't reach the bracket.
 *
 * SINGLE ELIMINATION order:
 *   1. Champion  = winner of the Final
 *   2. Runner-up = loser of the Final
 *   3rd / 4th    = winner / loser of the Bronze (3rd-place) match, when one
 *                  exists; otherwise the two Semi-final losers, ranked by pool
 *                  score (so the rule "separate same-phase fighters by pool
 *                  score" still applies when there's no playoff).
 *   then         = the losers of each earlier round, grouped by the round they
 *                  were eliminated in (deepest first), and WITHIN a round
 *                  ordered by pool score (descending), name as a stable
 *                  fallback.
 *
 * DOUBLE ELIMINATION order:
 *   1. / 2.      = the last PLAYED grand final. The reset slot exists whenever
 *                  the option is on but is only played when the losers-bracket
 *                  entrant wins the first grand final, so an unplayed reset
 *                  must fall back to the grand final rather than reading as an
 *                  undecided bracket.
 *   then         = eliminated by LOSING IN THE LOSERS BRACKET, deepest LB round
 *                  first. A winners-bracket loss eliminates nobody — the
 *                  fighter drops to the LB — so WB slots contribute no
 *                  placements at all.
 *   then         = play-in (round 0) losers. The play-in is a single-elim
 *                  qualifier, so its losers go out on one loss.
 *
 * Both then finish with every pool fighter who never reached the bracket.
 *
 * Winner of a match is the recorded `winnerRegistrationId` when present —
 * forfeits and black cards can complete a match with the LOWER score winning
 * (e.g. an injury forfeit keeps the current 5-3 but awards the opponent).
 * Score comparison is only the fallback for slots without a recorded winner.
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

/**
 * Bracket shape, needed to read a double-elim bracket's round numbering.
 * Omit it (or pass single_elim) for the single-elimination ordering.
 */
export interface RankingBracketShape {
  phaseType: 'single_elim' | 'double_elim';
  wbRounds?: number | null;
  lbRounds?: number | null;
}

export type FinalRankingResultKind =
  | 'champion'
  | 'runnerUp'
  | 'third'
  | 'fourth'
  | 'round'
  | 'pool';

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
   *  the first losers round), or 0 for a play-in loser. */
  eliminationRound?: number;
  /** Only set for double-elim, so surfaces can label "Losers R3" rather than
   *  printing a meaningless absolute round number. */
  bracketSection?: FinalRankingBracketSection;
}

interface Side {
  registrationId: string;
  fighterName: string;
  clubAbbrev: string | null;
}

function winnerLoser(slot: RankingSlot): { winner: Side; loser: Side } | null {
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
class Ranking {
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
function losersByRound(slots: RankingSlot[], r: Ranking): Map<number, Side[]> {
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

function orderSingleElim(slots: RankingSlot[], bronzeSlotId: string | null, r: Ranking): boolean {
  const maxRound = slots.reduce((m, s) => Math.max(m, s.round), 0);
  const bronzeSlot = bronzeSlotId
    ? (slots.find((s) => s.id === bronzeSlotId) ?? null)
    : (slots.find((s) => s.round === maxRound && s.position === 2) ?? null);

  // Main bracket = everything but the bronze/consolation slot, so each fighter
  // loses at most once and the Final is the only match at maxRound.
  const mainSlots = bronzeSlot ? slots.filter((s) => s.id !== bronzeSlot.id) : slots;
  const finalSlot =
    mainSlots.find((s) => s.round === maxRound && s.position === 1) ??
    mainSlots.find((s) => s.round === maxRound) ??
    null;

  // The ranking is only meaningful once the Final is decided — until then the
  // bracket is mid-play and earlier-round placements (and the non-bracket tail)
  // would be numbered wrong. 1st / 2nd come from the Final.
  const finalWl = finalSlot ? winnerLoser(finalSlot) : null;
  if (!finalWl) return false;
  r.push(finalWl.winner, 'champion');
  r.push(finalWl.loser, 'runnerUp');

  // 3rd / 4th — the Bronze match decides when present.
  if (bronzeSlot) {
    const wl = winnerLoser(bronzeSlot);
    if (wl) {
      r.push(wl.winner, 'third');
      r.push(wl.loser, 'fourth');
    }
  }

  // Everyone else in the bracket: grouped by the round they lost in (the Final
  // is already handled). With a bronze match the Semi-final losers are already
  // placed (3rd/4th) and skipped here; without one they fall into the
  // maxRound-1 group and get separated by pool score.
  const byRound = losersByRound(
    mainSlots.filter((s) => s.round !== maxRound),
    r,
  );
  for (const round of [...byRound.keys()].sort((a, b) => b - a)) {
    r.pushRound(byRound.get(round)!, { eliminationRound: round });
  }
  return true;
}

function orderDoubleElim(slots: RankingSlot[], shape: RankingBracketShape, r: Ranking): boolean {
  const wbRounds = shape.wbRounds ?? 0;
  const lbRounds = shape.lbRounds ?? 0;
  const gfRound = wbRounds + lbRounds + 1;

  // The reset is CONDITIONAL: it only happens when the losers-bracket entrant
  // wins the first grand final. Reading maxRound here instead would find the
  // unplayed reset slot and report the whole tournament as undecided.
  const resetSlot = slots.find((s) => s.round === gfRound + 1) ?? null;
  const resetWl = resetSlot ? winnerLoser(resetSlot) : null;
  const finalWl = resetWl ?? winnerLoser(slots.find((s) => s.round === gfRound) ?? ({} as never));
  if (!finalWl) return false;
  r.push(finalWl.winner, 'champion');
  r.push(finalWl.loser, 'runnerUp');

  // Only a LOSERS-bracket loss eliminates: a WB loss drops the fighter into
  // the LB, where they may still finish anywhere from 3rd to last. So WB slots
  // contribute no placements — every WB loser is placed by their LB exit.
  const lbSlots = slots.filter((s) => s.round > wbRounds && s.round <= wbRounds + lbRounds);
  const byRound = losersByRound(lbSlots, r);
  for (const round of [...byRound.keys()].sort((a, b) => b - a)) {
    r.pushRound(
      byRound.get(round)!,
      { eliminationRound: round - wbRounds, bracketSection: 'LB' },
      true,
    );
  }

  // Play-in losers went out on a single loss — below everyone who reached the
  // main bracket, above fighters who never made the bracket at all.
  const playIn = losersByRound(
    slots.filter((s) => s.round === 0),
    r,
  );
  for (const side of playIn.get(0) ?? []) {
    r.push(side, 'round', { eliminationRound: 0, bracketSection: 'PLAYIN' });
  }
  return true;
}

/**
 * Build the shape argument from a `getTournamentBracket()`-style payload, so
 * every call site derives it identically instead of hand-casting `phaseType`.
 * Anything that isn't explicitly `double_elim` reads as single-elim, which is
 * the safe default for legacy phases with no shape recorded.
 */
export function rankingBracketShape(bracket: {
  phaseType?: string | null;
  wbRounds?: number | null;
  lbRounds?: number | null;
}): RankingBracketShape {
  return {
    phaseType: bracket.phaseType === 'double_elim' ? 'double_elim' : 'single_elim',
    wbRounds: bracket.wbRounds ?? null,
    lbRounds: bracket.lbRounds ?? null,
  };
}

export function computeFinalRanking(
  slots: RankingSlot[],
  poolEntries: PoolEntry[],
  bronzeSlotId?: string | null,
  bracket?: RankingBracketShape | null,
): FinalRankingEntry[] {
  const r = new Ranking(poolEntries);

  // Every registration that appears anywhere in the bracket — used to keep the
  // non-bracket tail (pool-only fighters) strictly below all bracket entrants,
  // even bracket fighters not yet placed (an in-progress bracket).
  const bracketRegIds = new Set<string>();
  for (const s of slots) {
    if (s.redRegistrationId) bracketRegIds.add(s.redRegistrationId);
    if (s.blueRegistrationId) bracketRegIds.add(s.blueRegistrationId);
  }

  const decided =
    bracket?.phaseType === 'double_elim'
      ? orderDoubleElim(slots, bracket, r)
      : orderSingleElim(slots, bronzeSlotId ?? null, r);
  if (!decided) return [];

  // Tail: everyone who competed in the pools but never reached the bracket,
  // ranked by pool score. Kept strictly below all bracket entrants.
  const nonBracket = poolEntries
    .filter((e) => !bracketRegIds.has(e.registrationId) && !r.has(e.registrationId))
    .sort(r.byPoolScore);
  for (const e of nonBracket) {
    r.push(
      { registrationId: e.registrationId, fighterName: e.fighterName, clubAbbrev: e.clubAbbrev },
      'pool',
    );
  }

  return r.entries;
}
