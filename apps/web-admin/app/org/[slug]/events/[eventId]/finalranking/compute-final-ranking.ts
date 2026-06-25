/**
 * Final-ranking computation for a single-elimination bracket — the admin
 * mirror of the public final ranking, plus a pool-score tiebreak.
 *
 * Order:
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
 * Winner of a match is the higher match score (mirrors the bracket view's
 * winnerName/loserName + the public page). Pure: no React, no I/O.
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
}

export type FinalRankingResultKind = 'champion' | 'runnerUp' | 'third' | 'fourth' | 'round';

export interface FinalRankingEntry {
  place: number;
  registrationId: string;
  fighterName: string;
  clubAbbrev: string | null;
  poolScore: number | null;
  resultKind: FinalRankingResultKind;
  /** Bracket round the fighter was eliminated in — only when resultKind === 'round'. */
  eliminationRound?: number;
}

interface Side {
  registrationId: string;
  fighterName: string;
  clubAbbrev: string | null;
}

function winnerLoser(slot: RankingSlot): { winner: Side; loser: Side } | null {
  if (slot.status !== 'completed') return null;
  if (slot.redScore === null || slot.blueScore === null || slot.redScore === slot.blueScore) {
    return null;
  }
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
  return slot.redScore > slot.blueScore
    ? { winner: red, loser: blue }
    : { winner: blue, loser: red };
}

export function computeFinalRanking(
  slots: RankingSlot[],
  poolScoreByReg: Map<string, number>,
  bronzeSlotId?: string | null,
): FinalRankingEntry[] {
  if (slots.length === 0) return [];

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

  const entries: FinalRankingEntry[] = [];
  const placed = new Set<string>();
  const poolScoreOf = (regId: string): number | null => poolScoreByReg.get(regId) ?? null;

  const push = (side: Side, resultKind: FinalRankingResultKind, eliminationRound?: number) => {
    if (placed.has(side.registrationId)) return;
    entries.push({
      place: entries.length + 1,
      registrationId: side.registrationId,
      fighterName: side.fighterName,
      clubAbbrev: side.clubAbbrev,
      poolScore: poolScoreOf(side.registrationId),
      resultKind,
      ...(eliminationRound !== undefined ? { eliminationRound } : {}),
    });
    placed.add(side.registrationId);
  };

  // 1st / 2nd — the Final.
  if (finalSlot) {
    const wl = winnerLoser(finalSlot);
    if (wl) {
      push(wl.winner, 'champion');
      push(wl.loser, 'runnerUp');
    }
  }

  // 3rd / 4th — the Bronze match decides when present.
  if (bronzeSlot) {
    const wl = winnerLoser(bronzeSlot);
    if (wl) {
      push(wl.winner, 'third');
      push(wl.loser, 'fourth');
    }
  }

  // Everyone else: grouped by the round they lost in (the Final is already
  // handled). With a bronze match the Semi-final losers are already placed
  // (3rd/4th) and skipped here; without one they fall into the maxRound-1 group
  // and get separated by pool score.
  const losersByRound = new Map<number, Side[]>();
  for (const slot of mainSlots) {
    if (slot.round === maxRound) continue;
    const wl = winnerLoser(slot);
    if (!wl || placed.has(wl.loser.registrationId)) continue;
    const group = losersByRound.get(slot.round) ?? [];
    group.push(wl.loser);
    losersByRound.set(slot.round, group);
  }

  const rounds = [...losersByRound.keys()].sort((a, b) => b - a);
  for (const round of rounds) {
    const group = losersByRound.get(round)!;
    group.sort((a, b) => {
      const sa = poolScoreOf(a.registrationId);
      const sb = poolScoreOf(b.registrationId);
      const na = sa ?? Number.NEGATIVE_INFINITY;
      const nb = sb ?? Number.NEGATIVE_INFINITY;
      if (nb !== na) return nb - na;
      return a.fighterName.localeCompare(b.fighterName);
    });
    for (const side of group) push(side, 'round', round);
  }

  return entries;
}
