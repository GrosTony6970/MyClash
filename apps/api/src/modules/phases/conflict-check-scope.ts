/**
 * conflict-check-scope.ts — which of the Event's referee verdicts the Pools page of one
 * Tournament shows.
 *
 * The checker judges the whole Event (ADR-016: a referee is one body across every
 * Tournament). A verdict concerns Tournament T when its duty sits in T, OR when any of its
 * reasons points into T: a Pool-scoped crew of ANOTHER Tournament whose referee fights one
 * of T's bouts at the same time is a clash T's organiser must see, although the duty is not
 * T's. Filtering on the duty alone dropped exactly that case — the one the old Match-only
 * read could not see either.
 *
 * Pure: no I/O.
 */
import type {
  AssignmentBoardPool,
  RefereeConflictEntry,
} from '../referees/assignment-board.service';
import { groupIdOf } from '../referees/event-commitments';

export function conflictsTouchingTournament(
  conflicts: readonly RefereeConflictEntry[],
  units: readonly AssignmentBoardPool[],
  tournamentId: string,
): RefereeConflictEntry[] {
  const own = units.filter((u) => u.tournamentId === tournamentId);
  const unitIds = new Set(own.map((u) => u.id));
  const matchIds = new Set(own.flatMap((u) => u.matches.map((m) => m.id)));
  const groupIds = new Set(own.map(groupIdOf).filter((id): id is string => id !== null));
  const pointsIntoT = (entry: RefereeConflictEntry) =>
    entry.reasons.some((r) => {
      if (!r.against) return false;
      if (r.against.kind === 'match') return matchIds.has(r.against.id);
      if (r.against.kind === 'pool') return groupIds.has(r.against.id);
      if (r.against.kind === 'unit') return unitIds.has(r.against.id);
      return false;
    });
  return conflicts.filter((entry) => entry.tournamentId === tournamentId || pointsIntoT(entry));
}
