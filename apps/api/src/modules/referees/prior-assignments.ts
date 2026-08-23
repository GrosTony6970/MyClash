import type { PriorAssignment } from '@myclash/rulesets/scheduling';

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
  /** Every match this unit wraps: one for a bracket unit, a whole Swiss
   *  (round × piste) for a Swiss one. */
  matchIds?: string[];
}

/**
 * Derive the engine's `priorAssignments` from the board's persisted rows.
 *
 * Only MANUAL, role-bearing rows become priors: auto-assigned chips are
 * wiped & regenerated every run, so they must not constrain. Pool-scoped
 * rows key on `pool_id`; match-scoped rows (bracket, Swiss) resolve to the
 * synthetic unit whose `matchIds` CONTAINS that match — the id the engine
 * uses. A Swiss unit's N rows all resolve to the same unit, so the priors are
 * deduped: the engine expects one prior per (unit, role).
 * Rows that resolve to no unit are dropped.
 *
 * Pure: no I/O.
 */
export function priorAssignmentsFromRows(
  rows: PriorAssignmentRow[],
  pools: PriorPoolRef[],
): PriorAssignment[] {
  const unitIdByMatchId = new Map<string, string>();
  for (const pool of pools) {
    for (const matchId of pool.matchIds ?? []) unitIdByMatchId.set(matchId, pool.id);
  }

  const seen = new Set<string>();
  return rows.flatMap((row) => {
    if (row.auto_assigned) return [];
    if (!row.role) return [];

    let poolId: string | null = null;
    if (row.pool_id) {
      poolId = row.pool_id;
    } else if (row.match_id) {
      poolId = unitIdByMatchId.get(row.match_id) ?? null;
    }
    if (!poolId) return [];

    const key = `${poolId}:${row.role}:${row.person_id}`;
    if (seen.has(key)) return [];
    seen.add(key);

    return [{ poolId, role: row.role, personId: row.person_id }];
  });
}
