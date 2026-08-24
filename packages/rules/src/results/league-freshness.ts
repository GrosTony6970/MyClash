/**
 * league-freshness.ts — is the table on screen still the table the results say?
 *
 * Pure by design, like `event-readiness.ts`: every rule lives here and the
 * service beside it only gathers rows. Recompute is NEVER triggered by a match
 * completing — the only callers are an event status change, the status ticker,
 * and the two manual endpoints — so a league table is stale by DEFAULT and
 * fresh only for as long as nothing has been played since. That is the inverse
 * of what a reader assumes when they look at a standings page, which is the
 * whole reason this exists.
 */

export type LeagueFreshnessState =
  /** A finalized season. Its table is frozen ON PURPOSE and cannot go stale. */
  | 'frozen'
  /** Linked tournaments exist but recompute has never run. */
  | 'never_computed'
  /** Nothing has changed in any linked tournament since the last recompute. */
  | 'fresh'
  /** At least one linked tournament changed after the last recompute. */
  | 'stale';

/** One approved-linked tournament and when its matches last changed. */
export interface LinkedTournamentChange {
  tournamentId: string;
  name: string;
  /** MAX(matches.updated_at) across the tournament's phases; null with no matches. */
  lastChangedAt: string | null;
}

export interface LeagueFreshnessInput {
  /** `leagues.finalized_at` — non-null means the season is frozen. */
  finalizedAt: string | null;
  /** MAX(computed_at) over the league's rankings; null when never computed. */
  computedAt: string | null;
  linkedTournaments: LinkedTournamentChange[];
}

export interface LeagueFreshnessReport {
  state: LeagueFreshnessState;
  computedAt: string | null;
  /** Names of the tournaments that moved after `computedAt`, for the badge. */
  changedTournamentNames: string[];
}

/**
 * A tournament counts as changed when its last match write is strictly AFTER
 * the recompute. Equal timestamps are treated as unchanged: a recompute reads
 * the results it is computing from, so a tie means the same state, and
 * reporting it as stale would leave a badge nobody can ever clear.
 */
function changedSince(computedAt: string, tournament: LinkedTournamentChange): boolean {
  if (!tournament.lastChangedAt) return false;
  return new Date(tournament.lastChangedAt).getTime() > new Date(computedAt).getTime();
}

export function computeLeagueFreshness(input: LeagueFreshnessInput): LeagueFreshnessReport {
  // Frozen wins over everything. A finalized season deliberately stops moving
  // as late linked events tick over (`recomputeForEvent` skips it and
  // `recomputeLeagueRankings` refuses it), so "stale" would be a lie: there is
  // no action to take and the organiser reopens the season or does nothing.
  if (input.finalizedAt) {
    return { state: 'frozen', computedAt: input.computedAt, changedTournamentNames: [] };
  }

  // No linked tournaments means nothing can contribute, so there is nothing to
  // be stale about — an empty league reads fresh rather than never-computed,
  // which would nag an organiser to run a recompute that would do nothing.
  if (input.linkedTournaments.length === 0) {
    return { state: 'fresh', computedAt: input.computedAt, changedTournamentNames: [] };
  }

  if (!input.computedAt) {
    return { state: 'never_computed', computedAt: null, changedTournamentNames: [] };
  }

  const changed = input.linkedTournaments.filter((t) => changedSince(input.computedAt!, t));
  return {
    state: changed.length > 0 ? 'stale' : 'fresh',
    computedAt: input.computedAt,
    changedTournamentNames: changed.map((t) => t.name),
  };
}
