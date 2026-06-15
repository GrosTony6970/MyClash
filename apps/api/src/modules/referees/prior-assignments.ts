import type { PriorAssignment } from '@myclash/rulesets/dist/scheduling/index';

/** Minimal shape of a persisted referee_assignments row (subset of
 *  RefereeAssignmentRow) needed to derive a prior. */
export interface PriorAssignmentRow {
  person_id: string;
  pool_id: string | null;
  match_id: string | null;
  role: string | null;
  auto_assigned: boolean;
}

/** Minimal shape of an AssignmentBoardPool needed to resolve match-scoped
 *  rows to the engine's synthetic pool id. */
export interface PriorPoolRef {
  id: string;
  matchId?: string;
}

/**
 * Derive the engine's `priorAssignments` from the board's persisted rows.
 *
 * Only MANUAL, role-bearing rows become priors: auto-assigned chips are
 * wiped & regenerated every run, so they must not constrain. Pool-scoped
 * rows key on `pool_id`; bracket rows (scope 'match') resolve to the
 * synthetic pool whose `matchId` wraps that match — the id the engine uses.
 * Rows that resolve to no pool are dropped.
 *
 * Pure: no I/O.
 */
export function priorAssignmentsFromRows(
  rows: PriorAssignmentRow[],
  pools: PriorPoolRef[],
): PriorAssignment[] {
  return rows.flatMap((row) => {
    if (row.auto_assigned) return [];
    if (!row.role) return [];

    let poolId: string | null = null;
    if (row.pool_id) {
      poolId = row.pool_id;
    } else if (row.match_id) {
      poolId = pools.find((p) => p.matchId === row.match_id)?.id ?? null;
    }
    if (!poolId) return [];

    return [{ poolId, role: row.role, personId: row.person_id }];
  });
}
