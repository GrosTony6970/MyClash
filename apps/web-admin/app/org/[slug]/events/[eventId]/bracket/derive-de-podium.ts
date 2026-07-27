import type { BracketSlotData, PodiumData } from '@myclash/ui';

/**
 * Medal podium for a double-elimination bracket, for the admin bracket page.
 *
 * Which slots decide the podium depends entirely on the podium model:
 *
 *   GOLD    Gold/silver come from the last PLAYED grand final — the reset slot
 *           exists whenever the option is on but is only played when the
 *           losers-bracket entrant wins, so an enabled-but-unplayed reset must
 *           not blank the podium. Nobody plays for bronze: 3rd is whoever lost
 *           the losers final, 4th the LB semi's loser.
 *
 *   BRONZE  There is no grand final at all. Gold/silver come from the WINNERS
 *           bracket final, and the repechage's last round IS a bronze match —
 *           so 3rd is its WINNER, not its loser.
 *
 *   BRONZE, no bronze match
 *           The repechage stopped a round early and the two survivors are
 *           separated by pool score, which this page has no scores for. The
 *           podium shows gold/silver only; the Final ranking page is the
 *           authority for 3rd/4th.
 *
 * Mirrors `derivePodium` in web-public's tournament-data.ts — same rules, but
 * the two apps carry different slot shapes, so the logic is stated twice
 * rather than shared through a package.
 */

interface PodiumBracket {
  slots: BracketSlotData[];
  wbRounds?: number | null;
  lbRounds?: number | null;
  secondChanceTarget?: 'gold' | 'bronze';
  bronzeMatch?: boolean;
}

interface NameReaders {
  winnerName: (slot: BracketSlotData) => PodiumData['gold'];
  loserName: (slot: BracketSlotData) => PodiumData['gold'];
}

export function deriveDoubleElimPodium(
  bracket: PodiumBracket,
  { winnerName, loserName }: NameReaders,
): PodiumData {
  const wbRounds = bracket.wbRounds ?? 0;
  const lbRounds = bracket.lbRounds ?? 0;
  const at = (round: number) => bracket.slots.find((s) => s.round === round) ?? null;
  const done = (slot: BracketSlotData | null) => slot?.status === 'completed';
  const won = (slot: BracketSlotData | null) => (done(slot) ? winnerName(slot!) : null);
  const lost = (slot: BracketSlotData | null) => (done(slot) ? loserName(slot!) : null);

  if (bracket.secondChanceTarget === 'bronze') {
    const wbFinal = at(wbRounds);
    const bronzeSlot = bracket.bronzeMatch === false ? null : at(wbRounds + lbRounds);
    return {
      gold: won(wbFinal),
      silver: lost(wbFinal),
      bronze: won(bronzeSlot),
      fourth: lost(bronzeSlot),
    };
  }

  const gfRound = wbRounds + lbRounds + 1;
  const reset = at(gfRound + 1);
  const final = done(reset) ? reset : at(gfRound);
  return {
    gold: won(final),
    silver: lost(final),
    bronze: lost(at(gfRound - 1)),
    fourth: lost(at(gfRound - 2)),
  };
}
