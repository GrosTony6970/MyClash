import type { PriorAssignment } from '@myclash/rulesets/scheduling';
import type { AssignmentBoardPool } from './assignment-board.service';
import { unitIndex } from './event-commitments';

/** Minimal shape of a persisted referee_assignments row (subset of
 *  RefereeAssignmentRow) needed to derive a prior. */
export interface PriorAssignmentRow {
  person_id: string;
  pool_id: string | null;
  match_id: string | null;
  role: string | null;
  auto_assigned: boolean;
}

/**
 * Derive the engine's `priorAssignments` from the board's persisted rows.
 *
 * Only MANUAL, role-bearing rows become priors: auto-assigned chips are
 * wiped & regenerated every run, so they must not constrain. A row resolves
 * to the unit that holds it (`unitIndex`, the one owner): a Pool-scoped row to
 * its Pool, a match-scoped row to the unit holding its bout — a bracket bout,
 * a Swiss (round × piste), or a real Pool staffed bout by bout from the Pools
 * page. A unit's several rows are deduped: the engine expects one prior per
 * (unit, role, person). Rows that resolve to no unit are dropped.
 *
 * Pure: no I/O.
 */
export function priorAssignmentsFromRows(
  rows: PriorAssignmentRow[],
  units: readonly AssignmentBoardPool[],
): PriorAssignment[] {
  const unitOf = unitIndex(units);
  const seen = new Set<string>();
  return rows.flatMap((row) => {
    if (row.auto_assigned) return [];
    if (!row.role) return [];
    const poolId = unitOf(row)?.id;
    if (!poolId) return [];

    const key = `${poolId}:${row.role}:${row.person_id}`;
    if (seen.has(key)) return [];
    seen.add(key);

    return [{ poolId, role: row.role, personId: row.person_id }];
  });
}
