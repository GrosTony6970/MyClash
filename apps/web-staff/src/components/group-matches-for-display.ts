/**
 * Group a piste's matches under the tournament each belongs to, for DISPLAY.
 *
 * Deliberately not `groupLiceMatchesByTournament` (lice-tournament-context.ts):
 * that one drops matches with no `tournamentId`, because its output drives
 * pool/bracket FETCHES and there is nothing to fetch without an id. A display
 * list must drop nothing — a bout the operator has to score is not allowed to
 * vanish because its phase lost its tournament join. Those land in a trailing
 * null-id bucket the caller labels generically.
 *
 * Order is first-appearance, so the tournament running now heads the list.
 * React-free and structurally typed, like its sibling.
 */

export interface DisplayMatchGroup<T> {
  /** Null for the bucket of matches with no tournament — always last. */
  tournamentId: string | null;
  tournamentName: string | null;
  matches: T[];
}

interface GroupableMatch {
  tournamentId?: string | null;
  tournamentName?: string | null;
}

export function groupMatchesForDisplay<T extends GroupableMatch>(
  matches: readonly T[],
): Array<DisplayMatchGroup<T>> {
  const byId = new Map<string, DisplayMatchGroup<T>>();
  const orphans: T[] = [];

  for (const match of matches) {
    const id = match.tournamentId ?? null;
    if (!id) {
      orphans.push(match);
      continue;
    }
    const existing = byId.get(id);
    if (existing) {
      existing.matches.push(match);
      continue;
    }
    byId.set(id, {
      tournamentId: id,
      tournamentName: match.tournamentName ?? null,
      matches: [match],
    });
  }

  const groups = Array.from(byId.values());
  if (orphans.length > 0) {
    groups.push({ tournamentId: null, tournamentName: null, matches: orphans });
  }
  return groups;
}

/**
 * Whether the grouping is worth rendering as headed subsections.
 *
 * One group means every heading would say the same thing, which on a phone-
 * sized piste screen costs a row of vertical space and buys nothing.
 */
export function needsTournamentHeadings(
  groups: ReadonlyArray<DisplayMatchGroup<unknown>>,
): boolean {
  return groups.length > 1;
}
