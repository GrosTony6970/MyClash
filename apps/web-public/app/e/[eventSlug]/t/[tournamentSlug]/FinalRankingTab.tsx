import type { BracketSlot } from './page';

interface PodiumLike {
  gold?: { fighterName: string; clubAbbrev?: string | null } | null;
  silver?: { fighterName: string; clubAbbrev?: string | null } | null;
  bronze?: { fighterName: string; clubAbbrev?: string | null } | null;
  fourth?: { fighterName: string; clubAbbrev?: string | null } | null;
}

interface Props {
  /**
   * True when every match in this tournament is in a terminal state
   * (completed). Drives whether the ranking renders, or a "not ready
   * yet" placeholder.
   */
  isTournamentCompleted: boolean;
  podium: PodiumLike | null;
  bracketSlots: BracketSlot[];
}

/**
 * Final Ranking — derived from the podium (gold/silver/bronze/4th)
 * and the bracket's eliminated fighters by round.
 *
 * Visibility on the parent TournamentTabs is always TRUE so visitors
 * know the section exists; the content gates on tournament completion.
 */
export function FinalRankingTab({ isTournamentCompleted, podium, bracketSlots }: Props) {
  if (!isTournamentCompleted) {
    return (
      <div className="rounded-xl border border-dashed border-stone-300 bg-white p-8 text-center text-sm text-slate-500">
        Final ranking will appear here once every match is complete.
      </div>
    );
  }

  // Derive places from the podium first (top 4), then fill the rest
  // from bracket-loser positions. Pool-only tournaments fall back to
  // pool standings; that v1 case is out-of-scope for this slice and
  // renders a graceful "ranking incomplete" notice.
  const podiumEntries: Array<{ place: number; name: string; club: string | null }> = [];
  if (podium?.gold) {
    podiumEntries.push({
      place: 1,
      name: podium.gold.fighterName,
      club: podium.gold.clubAbbrev ?? null,
    });
  }
  if (podium?.silver) {
    podiumEntries.push({
      place: 2,
      name: podium.silver.fighterName,
      club: podium.silver.clubAbbrev ?? null,
    });
  }
  if (podium?.bronze) {
    podiumEntries.push({
      place: 3,
      name: podium.bronze.fighterName,
      club: podium.bronze.clubAbbrev ?? null,
    });
  }
  if (podium?.fourth) {
    podiumEntries.push({
      place: 4,
      name: podium.fourth.fighterName,
      club: podium.fourth.clubAbbrev ?? null,
    });
  }

  // Bracket losers by round desc, excluding fighters already on the
  // podium. Rounds further back lose earlier → lower placement.
  const podiumNames = new Set(podiumEntries.map((e) => e.name));
  const losersByRound: Array<{ round: number; names: string[] }> = [];
  const rounds = Array.from(new Set(bracketSlots.map((s) => s.round))).sort((a, b) => b - a);
  for (const round of rounds) {
    const slots = bracketSlots.filter((s) => s.round === round && s.status === 'completed');
    const losers: string[] = [];
    for (const s of slots) {
      const winnerIsRed = s.redScore !== null && s.blueScore !== null && s.redScore > s.blueScore;
      const loser = winnerIsRed ? s.blueFighterName : s.redFighterName;
      if (loser && !podiumNames.has(loser)) losers.push(loser);
    }
    if (losers.length > 0) losersByRound.push({ round, names: losers });
  }

  let nextPlace = podiumEntries.length + 1;
  const allEntries = [...podiumEntries];
  for (const tier of losersByRound) {
    for (const name of tier.names) {
      allEntries.push({ place: nextPlace++, name, club: null });
    }
  }

  if (allEntries.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-stone-300 bg-white p-8 text-center text-sm text-slate-500">
        Final ranking is being computed. Refresh in a moment.
      </div>
    );
  }

  return (
    <ol className="space-y-1">
      {allEntries.map((entry) => (
        <li
          key={`${entry.place}-${entry.name}`}
          className={
            'flex items-center gap-3 rounded-lg border bg-white px-4 py-2 ' +
            (entry.place === 1
              ? 'border-amber-300 bg-amber-50'
              : entry.place === 2
                ? 'border-slate-300 bg-slate-50'
                : entry.place === 3
                  ? 'border-orange-300 bg-orange-50'
                  : 'border-stone-200')
          }
        >
          <span
            className={
              'inline-flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold tabular-nums ' +
              (entry.place === 1
                ? 'bg-amber-200 text-amber-900'
                : entry.place === 2
                  ? 'bg-slate-200 text-slate-700'
                  : entry.place === 3
                    ? 'bg-orange-200 text-orange-900'
                    : 'bg-stone-100 text-slate-600')
            }
          >
            {entry.place}
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-slate-900 truncate">{entry.name}</p>
            {entry.club && <p className="text-xs text-slate-500 truncate">{entry.club}</p>}
          </div>
        </li>
      ))}
    </ol>
  );
}
