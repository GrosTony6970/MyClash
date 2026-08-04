import type { LiceMatch } from './lice-match-types';

/** A tournament with at least one match on this piste. */
export interface LiceTournamentContext {
  tournamentId: string;
  tournamentName: string | null;
  /** This lice's match ids for this tournament, in schedule order. */
  matchIds: string[];
  /** Any of this lice's matches sits in a pool → offer the pool view. */
  hasPools: boolean;
  /** Any sits in an elimination phase → offer the bracket view. */
  hasBracket: boolean;
}

const BRACKET_PHASES = new Set(['single_elim', 'double_elim']);

/**
 * One entry per tournament that touches this lice, in order of first
 * appearance in the schedule — so the tournament running now sorts first and
 * the operator never scrolls to find it.
 *
 * Matches with no `tournamentId` are dropped: without one there is nothing to
 * fetch, and a section that can only ever show an error is worse than none.
 */
export function groupLiceMatchesByTournament(
  matches: readonly LiceMatch[],
): LiceTournamentContext[] {
  const byId = new Map<string, LiceTournamentContext>();
  for (const match of matches) {
    if (!match.tournamentId) continue;
    const existing = byId.get(match.tournamentId);
    const entry: LiceTournamentContext = existing ?? {
      tournamentId: match.tournamentId,
      tournamentName: match.tournamentName,
      matchIds: [],
      hasPools: false,
      hasBracket: false,
    };
    entry.matchIds.push(match.id);
    if (match.poolId) entry.hasPools = true;
    if (match.phaseType && BRACKET_PHASES.has(match.phaseType)) entry.hasBracket = true;
    if (!existing) byId.set(match.tournamentId, entry);
  }
  return Array.from(byId.values());
}
