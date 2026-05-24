/**
 * referee-assigner.ts — T-903 + R3 of the Staffing overhaul
 *
 * Pure-function constraint engine for referee auto-assignment.
 * Implements ARCHITECTURE.md §11quater.2.
 *
 * R3 generalisation (commit-pair with the AssignmentBoardService refactor):
 *   - `RefereeRole` is loosened from a closed enum to `string` so any
 *     `referee_skills.id` (legacy or custom) can flow through.
 *   - Each `PoolSlot` carries `slotDefinitions[]` describing the slots
 *     to fill for that pool. The engine iterates slot-by-slot instead
 *     of looping the old module-level `ALL_ROLES` constant.
 *   - A slot can list multiple `allowedSkillIds`; the engine considers
 *     any candidate whose qualifications match any of them, scoring
 *     against the candidate's best matching qual.
 *   - When `slotDefinitions` is omitted, the engine falls back to
 *     `LEGACY_DEFAULT_SLOTS` (the three hard-coded roles) so existing
 *     callers + tests keep working with no surface change.
 *
 * Hard constraints (cannot be disabled):
 *   1. enforce_fighter_referee_no_overlap — fighter never referees a pool
 *      whose time overlaps their own match (AGENTS.md rule #8)
 *   2. Only candidates with an active qualification for one of the slot's
 *      allowed skills are considered
 *   3. A referee cannot be assigned twice to the same pool, even across
 *      different slots in that pool.
 *   4. A referee cannot be assigned to two pools whose time windows overlap.
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

/**
 * `RefereeRole` used to be a closed enum (3 hard-coded skill IDs). R3
 * relaxes it to any `referee_skills.id` string so custom skills introduced
 * via the Staffing tab can flow through. Kept as an alias for documentation.
 */
export type RefereeRole = string;

/**
 * `ALL_ROLES` is retained for callers that still want the legacy 3 roles
 * (e.g. UI dropdowns that haven't migrated). The engine itself does not
 * use this constant anymore — it iterates `pool.slotDefinitions` instead.
 */
export const ALL_ROLES: readonly RefereeRole[] = [
  'arbitre_declarant',
  'arbitre_assesseur',
  'arbitre_table',
] as const;

/**
 * Per-pool slot identity + admissible skill set. Mirrors the resolver
 * output (`StaffingService.ResolvedConfig.pool[i]`). A slot is satisfied
 * when a candidate has an active qualification for ANY of `allowedSkillIds`.
 */
export interface SlotDefinition {
  /** 1..6, matches `tournament_slot_config.slot_index`. */
  index: number;
  displayName: string | null;
  /** At least one skill id. */
  allowedSkillIds: string[];
}

/**
 * Legacy default — exactly mirrors `StaffingService.HARD_CODED_DEFAULT_SLOTS`.
 * Engine + service share this shape so a tournament with no Staffing
 * config still gets the same 3 slots (Décl/Asses/Table) auto-filled
 * exactly as before R3.
 */
export const LEGACY_DEFAULT_SLOTS: readonly SlotDefinition[] = [
  { index: 1, displayName: null, allowedSkillIds: ['arbitre_declarant'] },
  { index: 2, displayName: null, allowedSkillIds: ['arbitre_assesseur'] },
  { index: 3, displayName: null, allowedSkillIds: ['arbitre_table'] },
] as const;

export interface RefereeCandidate {
  personId: string;
  personName: string;
  /** Active qualifications for this event. `role` is now any skill_id. */
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
  /**
   * Slot definitions for this pool (typically from `StaffingService`).
   * Optional — when absent the engine uses `LEGACY_DEFAULT_SLOTS` so
   * pre-R3 callers and tests keep behaving identically.
   */
  slotDefinitions?: SlotDefinition[];
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
  /** R3: slot identity is load-bearing alongside role. */
  slotIndex: number;
  /** The specific skill_id chosen for the slot (one of slot.allowedSkillIds). */
  role: RefereeRole;
  personId: string;
  personName: string;
  autoAssigned: true;
}

export interface MissingAssignment {
  poolId: string;
  poolName: string;
  slotIndex: number;
  /** Primary skill_id for display (= slot.allowedSkillIds[0]). */
  role: RefereeRole;
  rejectionReasons: string[];
}

export interface AssignmentWarning {
  type: 'back_to_back' | 'workshop_conflict' | 'low_rating' | 'workload_imbalance';
  personId: string;
  personName: string;
  poolId: string;
  poolName: string;
  /** The skill_id assigned (matches `RefereeAssignment.role` shape). */
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

  for (const pool of pools) {
    const slots = pool.slotDefinitions ?? LEGACY_DEFAULT_SLOTS;
    for (const slot of slots) {
      const result = assignSlot(
        pool,
        slot,
        candidates,
        assignments,
        settings,
        personAssignmentCount,
        personAssignedPools,
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
        warnings.push(...result.warnings);
      } else {
        missing.push({
          poolId: pool.poolId,
          poolName: pool.poolName,
          slotIndex: slot.index,
          role: slot.allowedSkillIds[0]!,
          rejectionReasons: result.rejectionReasons,
        });
      }
    }
  }

  return { assignments, missing, warnings };
}

// ── Private: assign one slot in one pool ─────────────────────────────────────

interface SlotAssignmentResult {
  assigned: RefereeAssignment | null;
  warnings: AssignmentWarning[];
  rejectionReasons: string[];
}

/**
 * Pick the candidate's best matching qualification for a slot. R3 multi-
 * skill semantics: across all of the candidate's quals whose `role` is in
 * `slot.allowedSkillIds`, return the one with the highest rating.
 * `null` rating sorts below any numeric rating. Returns `null` when the
 * candidate has no matching qual at all.
 */
function bestMatchingQual(
  candidate: RefereeCandidate,
  slot: SlotDefinition,
): { role: RefereeRole; rating: number | null } | null {
  let best: { role: RefereeRole; rating: number | null } | null = null;
  for (const q of candidate.qualifications) {
    if (!slot.allowedSkillIds.includes(q.role)) continue;
    if (!best) {
      best = q;
      continue;
    }
    const bestRating = best.rating ?? -1;
    const thisRating = q.rating ?? -1;
    if (thisRating > bestRating) best = q;
  }
  return best;
}

function assignSlot(
  pool: PoolSlot,
  slot: SlotDefinition,
  candidates: RefereeCandidate[],
  existingAssignments: RefereeAssignment[],
  settings: AssignmentSettings,
  personAssignmentCount: Map<string, number>,
  personAssignedPools: Map<string, string[]>,
): SlotAssignmentResult {
  const warnings: AssignmentWarning[] = [];
  const rejectionReasons: string[] = [];

  // Filter: must have an active qualification for at least one of the
  // slot's allowed skills (HARD).
  const qualified = candidates
    .map((c) => ({ candidate: c, matchedQual: bestMatchingQual(c, slot) }))
    .filter(
      (
        row,
      ): row is {
        candidate: RefereeCandidate;
        matchedQual: { role: RefereeRole; rating: number | null };
      } => row.matchedQual !== null,
    );

  if (qualified.length === 0) {
    rejectionReasons.push('no_qualified_users');
    return { assigned: null, warnings, rejectionReasons };
  }

  // Filter: not already assigned to this pool in any slot (HARD)
  const alreadyAssignedToPool = new Set(
    existingAssignments.filter((a) => a.poolId === pool.poolId).map((a) => a.personId),
  );

  const notAlreadyAssigned = qualified.filter(
    (q) => !alreadyAssignedToPool.has(q.candidate.personId),
  );

  if (notAlreadyAssigned.length === 0) {
    rejectionReasons.push('all_qualified_already_assigned_to_pool');
    return { assigned: null, warnings, rejectionReasons };
  }

  // Filter: HARD constraint — fighter cannot referee pool whose time overlaps their match
  const noFighterOverlap = notAlreadyAssigned.filter(({ candidate }) => {
    for (const match of pool.matches) {
      const isFighter =
        candidate.fighterRegistrationIds.includes(match.redRegistrationId) ||
        candidate.fighterRegistrationIds.includes(match.blueRegistrationId);
      if (isFighter) return false;
    }
    return true;
  });

  if (noFighterOverlap.length === 0) {
    rejectionReasons.push('all_qualified_are_fighters_in_this_pool');
    return { assigned: null, warnings, rejectionReasons };
  }

  // Filter: HARD constraint — referee cannot be assigned to two pools at the same time
  const noTimeOverlap = noFighterOverlap.filter(({ candidate }) => {
    if (!pool.earliestStart || !pool.latestEnd) return true; // unscheduled — skip time check

    const poolStart = new Date(pool.earliestStart).getTime();
    const poolEnd = new Date(pool.latestEnd).getTime();

    for (const existing of existingAssignments) {
      if (existing.personId !== candidate.personId) continue;

      const assignedPool = pools.find((p) => p.poolId === existing.poolId);
      if (!assignedPool?.earliestStart || !assignedPool?.latestEnd) continue;

      const assignedStart = new Date(assignedPool.earliestStart).getTime();
      const assignedEnd = new Date(assignedPool.latestEnd).getTime();

      if (poolStart < assignedEnd && assignedStart < poolEnd) {
        return false;
      }
    }
    return true;
  });

  if (noTimeOverlap.length === 0) {
    rejectionReasons.push('all_qualified_have_time_conflict_with_other_pool');
    return { assigned: null, warnings, rejectionReasons };
  }

  // Score candidates (lower = better)
  const scored = noTimeOverlap.map(({ candidate, matchedQual }) => {
    let score = 0;
    const candidateWarnings: AssignmentWarning[] = [];

    if (settings.ratingBasedOrdering) {
      const rating = matchedQual.rating ?? 0;
      score -= rating * 10;
    }

    if (settings.workloadBalance) {
      score += (personAssignmentCount.get(candidate.personId) ?? 0) * 5;
    }

    if (settings.enforceRefereeNoBackToBack) {
      const assignedPools = personAssignedPools.get(candidate.personId) ?? [];
      if (assignedPools.length > 0) {
        const poolIndex = pools.indexOf(pool);
        const isBackToBack = assignedPools.some((pid) => {
          const prevIndex = pools.findIndex((p) => p.poolId === pid);
          return Math.abs(poolIndex - prevIndex) <= settings.refereeRestMinSlots;
        });

        if (isBackToBack) {
          score += 20;
          candidateWarnings.push({
            type: 'back_to_back',
            personId: candidate.personId,
            personName: candidate.personName,
            poolId: pool.poolId,
            poolName: pool.poolName,
            role: matchedQual.role,
            detail: `${candidate.personName} has back-to-back referee duties`,
          });
        }
      }
    }

    if (settings.workshopConflictWarning && pool.earliestStart && pool.latestEnd) {
      const poolStart = new Date(pool.earliestStart).getTime();
      const poolEnd = new Date(pool.latestEnd).getTime();

      for (const ws of candidate.workshopWindows) {
        const wsStart = new Date(ws.start).getTime();
        const wsEnd = new Date(ws.end).getTime();
        if (poolStart < wsEnd && wsStart < poolEnd) {
          score += 15;
          candidateWarnings.push({
            type: 'workshop_conflict',
            personId: candidate.personId,
            personName: candidate.personName,
            poolId: pool.poolId,
            poolName: pool.poolName,
            role: matchedQual.role,
            detail: `${candidate.personName} has a workshop during this pool`,
          });
        }
      }
    }

    return { candidate, matchedQual, score, candidateWarnings };
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
      slotIndex: slot.index,
      role: best.matchedQual.role,
      personId: best.candidate.personId,
      personName: best.candidate.personName,
      autoAssigned: true,
    },
    warnings,
    rejectionReasons: [],
  };
}

// Need pools reference in assignSlot — pass it via closure (pre-R3 pattern,
// kept for minimum-change behaviour).
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
