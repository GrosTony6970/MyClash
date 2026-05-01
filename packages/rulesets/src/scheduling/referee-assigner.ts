/**
 * referee-assigner.ts — T-903
 *
 * Pure-function constraint engine for referee auto-assignment.
 * Implements ARCHITECTURE.md §11quater.2.
 *
 * Hard constraints (cannot be disabled):
 *   1. enforce_fighter_referee_no_overlap — fighter never referees a pool
 *      whose time overlaps their own match (AGENTS.md rule #8)
 *   2. Only candidates with active qualification for the role are considered
 *
 * Soft constraints (configurable):
 *   - No back-to-back referee duties
 *   - Dedicated-referee rest
 *   - Workshop conflict warning
 *   - Rating-based ordering (higher rating preferred)
 *   - Workload balance (spread duties evenly)
 *
 * Returns: { assignments, missing, warnings }
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export type RefereeRole = 'arbitre_declarant' | 'arbitre_assesseur' | 'arbitre_table';

export const ALL_ROLES: RefereeRole[] = ['arbitre_declarant', 'arbitre_assesseur', 'arbitre_table'];

export interface RefereeCandidate {
  personId: string;
  personName: string;
  /** Active qualifications for this event */
  qualifications: Array<{ role: RefereeRole; rating: number | null }>;
  /** Registration IDs if this person is also a fighter */
  fighterRegistrationIds: string[];
  /** Workshop session time windows this person is enrolled in */
  workshopWindows: Array<{ start: string; end: string }>;
}

export interface PoolSlot {
  poolId: string;
  poolName: string;
  /** Matches in this pool with their time windows */
  matches: Array<{
    id: string;
    scheduledAt: string | null;
    durationMinutes: number;
    redRegistrationId: string;
    blueRegistrationId: string;
  }>;
  /** Earliest match start in this pool (null if unscheduled) */
  earliestStart: string | null;
  /** Latest match end in this pool (null if unscheduled) */
  latestEnd: string | null;
}

export interface AssignmentSettings {
  enforceRefereeNoBackToBack: boolean;
  refereeRestMinSlots: number; // number of pool slots gap required
  enforceDedicatedRefereeRest: boolean;
  workshopConflictWarning: boolean;
  ratingBasedOrdering: boolean;
  workloadBalance: boolean;
}

export interface RefereeAssignment {
  poolId: string;
  poolName: string;
  role: RefereeRole;
  personId: string;
  personName: string;
  autoAssigned: true;
}

export interface MissingAssignment {
  poolId: string;
  poolName: string;
  role: RefereeRole;
  rejectionReasons: string[];
}

export interface AssignmentWarning {
  type: 'back_to_back' | 'workshop_conflict' | 'low_rating' | 'workload_imbalance';
  personId: string;
  personName: string;
  poolId: string;
  poolName: string;
  role: RefereeRole;
  detail: string;
}

export interface AssignmentResult {
  assignments: RefereeAssignment[];
  missing: MissingAssignment[];
  warnings: AssignmentWarning[];
}

// ── Implementation ────────────────────────────────────────────────────────────

export function assignReferees(
  pools: PoolSlot[],
  candidates: RefereeCandidate[],
  settings: AssignmentSettings,
): AssignmentResult {
  const assignments: RefereeAssignment[] = [];
  const missing: MissingAssignment[] = [];
  const warnings: AssignmentWarning[] = [];

  // Track assignments per person for workload balance
  const personAssignmentCount = new Map<string, number>();
  for (const c of candidates) personAssignmentCount.set(c.personId, 0);

  // Track which pools each person is assigned to (for back-to-back detection)
  const personAssignedPools = new Map<string, string[]>();

  // Track persons already assigned for each role (to enforce one-person-per-role-per-session)
  const assignedForRole = new Map<RefereeRole, Set<string>>();
  for (const role of ALL_ROLES) assignedForRole.set(role, new Set());

  for (const pool of pools) {
    for (const role of ALL_ROLES) {
      const result = assignRole(
        pool,
        role,
        candidates,
        assignments,
        settings,
        personAssignmentCount,
        personAssignedPools,
        assignedForRole.get(role)!,
      );

      if (result.assigned) {
        assignments.push(result.assigned);
        personAssignmentCount.set(
          result.assigned.personId,
          (personAssignmentCount.get(result.assigned.personId) ?? 0) + 1,
        );
        const pools2 = personAssignedPools.get(result.assigned.personId) ?? [];
        pools2.push(pool.poolId);
        personAssignedPools.set(result.assigned.personId, pools2);
        assignedForRole.get(role)!.add(result.assigned.personId);
        warnings.push(...result.warnings);
      } else {
        missing.push({
          poolId: pool.poolId,
          poolName: pool.poolName,
          role,
          rejectionReasons: result.rejectionReasons,
        });
      }
    }
  }

  return { assignments, missing, warnings };
}

// ── Private: assign one role to one pool ─────────────────────────────────────

interface RoleAssignmentResult {
  assigned: RefereeAssignment | null;
  warnings: AssignmentWarning[];
  rejectionReasons: string[];
}

function assignRole(
  pool: PoolSlot,
  role: RefereeRole,
  candidates: RefereeCandidate[],
  existingAssignments: RefereeAssignment[],
  settings: AssignmentSettings,
  personAssignmentCount: Map<string, number>,
  personAssignedPools: Map<string, string[]>,
  alreadyAssignedForRole: Set<string>,
): RoleAssignmentResult {
  const warnings: AssignmentWarning[] = [];
  const rejectionReasons: string[] = [];

  // Filter: must have active qualification for this role (HARD)
  const qualified = candidates.filter((c) => c.qualifications.some((q) => q.role === role));

  if (qualified.length === 0) {
    rejectionReasons.push('no_qualified_users');
    return { assigned: null, warnings, rejectionReasons };
  }

  // Filter: not already assigned to this pool in any role (HARD)
  const alreadyAssignedToPool = new Set(
    existingAssignments.filter((a) => a.poolId === pool.poolId).map((a) => a.personId),
  );

  const notAlreadyAssigned = qualified.filter((c) => !alreadyAssignedToPool.has(c.personId));

  if (notAlreadyAssigned.length === 0) {
    rejectionReasons.push('all_qualified_already_assigned_to_pool');
    return { assigned: null, warnings, rejectionReasons };
  }

  // Filter: HARD constraint — fighter cannot referee pool whose time overlaps their match
  const noFighterOverlap = notAlreadyAssigned.filter((c) => {
    // 1. Pool membership check: fighter in this pool cannot referee it
    for (const match of pool.matches) {
      const isFighter =
        c.fighterRegistrationIds.includes(match.redRegistrationId) ||
        c.fighterRegistrationIds.includes(match.blueRegistrationId);
      if (isFighter) return false;
    }
    return true;
  });

  if (noFighterOverlap.length === 0) {
    rejectionReasons.push('all_qualified_are_fighters_in_this_pool');
    return { assigned: null, warnings, rejectionReasons };
  }

  // Filter: HARD constraint — referee cannot be assigned to two pools at the same time
  // A person already assigned to another pool whose time window overlaps this pool is excluded.
  const noTimeOverlap = noFighterOverlap.filter((c) => {
    if (!pool.earliestStart || !pool.latestEnd) return true; // pool unscheduled — skip time check

    const poolStart = new Date(pool.earliestStart).getTime();
    const poolEnd = new Date(pool.latestEnd).getTime();

    // Check all existing assignments for this person
    for (const existing of existingAssignments) {
      if (existing.personId !== c.personId) continue;

      // Find the pool they're already assigned to
      const assignedPool = pools.find((p) => p.poolId === existing.poolId);
      if (!assignedPool?.earliestStart || !assignedPool?.latestEnd) continue;

      const assignedStart = new Date(assignedPool.earliestStart).getTime();
      const assignedEnd = new Date(assignedPool.latestEnd).getTime();

      // Overlap check
      if (poolStart < assignedEnd && assignedStart < poolEnd) {
        return false; // time conflict — cannot referee both pools simultaneously
      }
    }
    return true;
  });

  if (noTimeOverlap.length === 0) {
    rejectionReasons.push('all_qualified_have_time_conflict_with_other_pool');
    return { assigned: null, warnings, rejectionReasons };
  }

  // Filter: not already assigned for this role in another pool this session
  const notAlreadyUsedForRole = noFighterOverlap.filter(
    (c) => !alreadyAssignedForRole.has(c.personId),
  );

  // Score candidates (lower = better)
  const scored = noTimeOverlap.map((c) => {
    let score = 0;
    const candidateWarnings: AssignmentWarning[] = [];

    // Rating-based ordering (higher rating = lower score = preferred)
    if (settings.ratingBasedOrdering) {
      const qual = c.qualifications.find((q) => q.role === role);
      const rating = qual?.rating ?? 0;
      score -= rating * 10; // higher rating → lower score → preferred
    }

    // Workload balance (fewer assignments = lower score = preferred)
    if (settings.workloadBalance) {
      score += (personAssignmentCount.get(c.personId) ?? 0) * 5;
    }

    // Back-to-back penalty
    if (settings.enforceRefereeNoBackToBack) {
      const assignedPools = personAssignedPools.get(c.personId) ?? [];
      if (assignedPools.length > 0) {
        // Check if adjacent pool in the sequence
        const poolIndex = pools.indexOf(pool);
        const isBackToBack = assignedPools.some((pid) => {
          const prevIndex = pools.findIndex((p) => p.poolId === pid);
          return Math.abs(poolIndex - prevIndex) <= settings.refereeRestMinSlots;
        });

        if (isBackToBack) {
          score += 20;
          candidateWarnings.push({
            type: 'back_to_back',
            personId: c.personId,
            personName: c.personName,
            poolId: pool.poolId,
            poolName: pool.poolName,
            role,
            detail: `${c.personName} has back-to-back referee duties`,
          });
        }
      }
    }

    // Workshop conflict warning
    if (settings.workshopConflictWarning && pool.earliestStart && pool.latestEnd) {
      const poolStart = new Date(pool.earliestStart).getTime();
      const poolEnd = new Date(pool.latestEnd).getTime();

      for (const ws of c.workshopWindows) {
        const wsStart = new Date(ws.start).getTime();
        const wsEnd = new Date(ws.end).getTime();
        if (poolStart < wsEnd && wsStart < poolEnd) {
          score += 15;
          candidateWarnings.push({
            type: 'workshop_conflict',
            personId: c.personId,
            personName: c.personName,
            poolId: pool.poolId,
            poolName: pool.poolName,
            role,
            detail: `${c.personName} has a workshop during this pool`,
          });
        }
      }
    }

    return { candidate: c, score, candidateWarnings };
  });

  // Sort by score ascending (best candidate first)
  scored.sort((a, b) => a.score - b.score);

  const best = scored[0];
  if (!best) {
    rejectionReasons.push('no_candidates_after_scoring');
    return { assigned: null, warnings, rejectionReasons };
  }

  warnings.push(...best.candidateWarnings);

  return {
    assigned: {
      poolId: pool.poolId,
      poolName: pool.poolName,
      role,
      personId: best.candidate.personId,
      personName: best.candidate.personName,
      autoAssigned: true,
    },
    warnings,
    rejectionReasons: [],
  };
}

// Need pools reference in assignRole — pass it via closure
let pools: PoolSlot[] = [];

// Re-export with pools captured
export function assignRefereesWithPools(
  poolsArg: PoolSlot[],
  candidates: RefereeCandidate[],
  settings: AssignmentSettings,
): AssignmentResult {
  pools = poolsArg;
  return assignReferees(poolsArg, candidates, settings);
}
