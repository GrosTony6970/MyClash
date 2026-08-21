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
  /**
   * Slice 8: explicit per-tournament allowlist. When undefined the engine
   * treats the candidate as available for every tournament (legacy
   * pre-Slice-8 behaviour). When set, the candidate is dropped from
   * candidates whose pool's `tournamentId` is not in the list.
   */
  availableTournamentIds?: string[];
  /** Slice 8: per-day allowlist. Same semantics as above. */
  availableDayIndices?: number[];
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
   * Slice 8: tournament owning this pool. Used by the engine to filter
   * candidates against their availableTournamentIds. Optional for
   * backwards compatibility with pre-Slice-8 callers / tests that don't
   * populate it — when undefined the per-tournament filter is skipped.
   */
  tournamentId?: string;
  /** Slice 8: 0-based day index relative to event.start_date. */
  dayIndex?: number;
  /**
   * Slot definitions for this pool (typically from `StaffingService`).
   * Optional — when absent the engine uses `LEGACY_DEFAULT_SLOTS` so
   * pre-R3 callers and tests keep behaving identically.
   */
  slotDefinitions?: SlotDefinition[];
  /**
   * Pool roster — personIds of every fighter registered for this pool.
   * Catches fighter-as-referee conflicts even before per-match
   * red/blue registration fields are wired up (e.g. pre-bracket
   * generation). Optional for backwards compatibility with pre-fix
   * callers and tests; when undefined the engine falls back to the
   * per-match registration check only.
   */
  memberPersonIds?: string[];
  /**
   * R4 metadata flag — marks bracket "pools" (synthesised as one-match
   * pools per bracket match) that represent medal-set matches. The
   * engine doesn't dispatch on this; it surfaces back through
   * `RefereeAssignment.isFinals` so consumers can group results by
   * phase-type. Caller-supplied via
   * `AssignmentBoardService.classifyBracketMatch`.
   */
  isFinals?: boolean;
}

export interface AssignmentSettings {
  enforceRefereeNoBackToBack: boolean;
  refereeRestMinSlots: number; // number of pool slots gap required
  enforceDedicatedRefereeRest: boolean;
  workshopConflictWarning: boolean;
  ratingBasedOrdering: boolean;
  workloadBalance: boolean;
  /** Per-rule toggles mirroring the Assignment Health rules. Optional,
   *  default TRUE when omitted so existing callers/tests keep the full
   *  hard-constraint behaviour. Disabling a rule skips its filter. */
  enableOwnPoolRule?: boolean;
  enableOfficiateVsFightRule?: boolean;
  enableDoubleBookedRule?: boolean;
  enableTwoRolesRule?: boolean;
  enableAvailabilityRule?: boolean;
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
  /** R4: mirrors PoolSlot.isFinals so callers can group output by phase. */
  isFinals?: boolean;
}

export interface MissingAssignment {
  poolId: string;
  poolName: string;
  slotIndex: number;
  /** Primary skill_id for display (= slot.allowedSkillIds[0]). */
  role: RefereeRole;
  rejectionReasons: string[];
  /** R4: mirrors PoolSlot.isFinals (same rationale as RefereeAssignment). */
  isFinals?: boolean;
}

/**
 * R4: proposed swap to relieve a back-to-back warning. The engine
 * scans completed assignments for `back_to_back` warnings and looks
 * for an alternative candidate that would resolve the chain without
 * introducing a new violation.
 */
export interface SwapSuggestion {
  fromPoolId: string;
  fromSlotIndex: number;
  fromPersonId: string;
  fromPersonName: string;
  toPersonId: string;
  toPersonName: string;
  /** Only reason supported in R4. */
  reason: 'breaks_back_to_back';
  detail: string;
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
  /** R4: back-to-back swap suggestions. May be empty. */
  swapSuggestions: SwapSuggestion[];
}

/**
 * An assignment that already exists on the board (typically a human's
 * manual pick) and must be treated as FIXED when the engine runs: the
 * engine won't propose into the same `(poolId, role)` slot, and the
 * person is fed into the conflict + workload checks so new proposals
 * don't double-book / back-to-back / two-role against them.
 */
export interface PriorAssignment {
  poolId: string;
  role: RefereeRole;
  personId: string;
}

// ── Implementation ────────────────────────────────────────────────────────────

export function assignReferees(
  pools: PoolSlot[],
  candidates: RefereeCandidate[],
  settings: AssignmentSettings,
  priorAssignments: PriorAssignment[] = [],
): AssignmentResult {
  // Newly-produced assignments — the only ones returned (priors already
  // live on the board and are re-applied by the persistence layer).
  const assignments: RefereeAssignment[] = [];
  const missing: MissingAssignment[] = [];
  const warnings: AssignmentWarning[] = [];

  // Track assignments per person for workload balance
  const personAssignmentCount = new Map<string, number>();
  for (const c of candidates) personAssignmentCount.set(c.personId, 0);

  // Track which pools each person is assigned to (for back-to-back detection)
  const personAssignedPools = new Map<string, string[]>();

  // `committed` = priors + produced, fed to assignSlot's conflict filters
  // (double-booking / two-roles). Kept separate from `assignments` so priors
  // constrain new picks without being returned as fresh proposals.
  const committed: Array<{ poolId: string; personId: string }> = [];

  // Seed the workload / back-to-back / conflict structures with the prior
  // (manual) assignments so new proposals avoid clashing with them.
  for (const prior of priorAssignments) {
    committed.push({ poolId: prior.poolId, personId: prior.personId });
    personAssignmentCount.set(prior.personId, (personAssignmentCount.get(prior.personId) ?? 0) + 1);
    const pp = personAssignedPools.get(prior.personId) ?? [];
    pp.push(prior.poolId);
    personAssignedPools.set(prior.personId, pp);
  }

  // Consumable per-pool list of prior roles, used to SKIP a slot a human
  // already filled (matched by role within the pool — the DB slot key is
  // (pool, role), there is no slot_index).
  const remainingPriorRolesByPool = new Map<string, string[]>();
  for (const prior of priorAssignments) {
    const arr = remainingPriorRolesByPool.get(prior.poolId) ?? [];
    arr.push(prior.role);
    remainingPriorRolesByPool.set(prior.poolId, arr);
  }

  for (const pool of pools) {
    const slots = pool.slotDefinitions ?? LEGACY_DEFAULT_SLOTS;
    for (const slot of slots) {
      // A manually-filled slot is left untouched: not proposed, not missing.
      const priorRoles = remainingPriorRolesByPool.get(pool.poolId);
      if (priorRoles && priorRoles.length > 0) {
        const idx = priorRoles.findIndex((r) => slot.allowedSkillIds.includes(r));
        if (idx !== -1) {
          priorRoles.splice(idx, 1); // consume this prior — slot is taken
          continue;
        }
      }

      const result = assignSlot(
        pool,
        slot,
        candidates,
        committed,
        settings,
        personAssignmentCount,
        personAssignedPools,
        pools,
      );

      if (result.assigned) {
        const stamped: RefereeAssignment = pool.isFinals
          ? { ...result.assigned, isFinals: true }
          : result.assigned;
        assignments.push(stamped);
        committed.push({ poolId: stamped.poolId, personId: stamped.personId });
        personAssignmentCount.set(
          stamped.personId,
          (personAssignmentCount.get(stamped.personId) ?? 0) + 1,
        );
        const pools2 = personAssignedPools.get(stamped.personId) ?? [];
        pools2.push(pool.poolId);
        personAssignedPools.set(stamped.personId, pools2);
        warnings.push(...result.warnings);
      } else {
        missing.push({
          poolId: pool.poolId,
          poolName: pool.poolName,
          slotIndex: slot.index,
          role: slot.allowedSkillIds[0]!,
          rejectionReasons: result.rejectionReasons,
          ...(pool.isFinals ? { isFinals: true } : {}),
        });
      }
    }
  }

  const swapSuggestions = computeSwapSuggestions(pools, assignments, candidates, warnings);

  return { assignments, missing, warnings, swapSuggestions };
}

// ── R4: swap suggestions for back-to-back violations ─────────────────────────

/**
 * Scan the result for `back_to_back` warnings and look for a swap that
 * would resolve each. Output is at most one suggestion per warning.
 *
 * Algorithm (intentionally simple — first-fit, no scoring):
 *   1. For each back-to-back warning, identify the slot it's attached to
 *      and the assigned person.
 *   2. Find an alternative candidate: must be qualified for the slot,
 *      must not be a fighter in the pool, must not already be assigned
 *      to the pool, must not have a time-overlap with another assignment,
 *      and the swap itself must not put THEM back-to-back with one of
 *      their existing duties.
 *   3. First match wins. If none exists, no suggestion is emitted for
 *      that warning.
 */
function computeSwapSuggestions(
  pools: PoolSlot[],
  assignments: RefereeAssignment[],
  candidates: RefereeCandidate[],
  warnings: AssignmentWarning[],
): SwapSuggestion[] {
  const backToBack = warnings.filter((w) => w.type === 'back_to_back');
  if (backToBack.length === 0) return [];

  const poolById = new Map(pools.map((p) => [p.poolId, p]));
  const assignmentsByPerson = new Map<string, RefereeAssignment[]>();
  for (const a of assignments) {
    const arr = assignmentsByPerson.get(a.personId) ?? [];
    arr.push(a);
    assignmentsByPerson.set(a.personId, arr);
  }
  const candidateByPerson = new Map(candidates.map((c) => [c.personId, c]));

  const out: SwapSuggestion[] = [];
  const seenSlots = new Set<string>();

  for (const warning of backToBack) {
    const slotKey = `${warning.poolId}:${warning.role}`;
    if (seenSlots.has(slotKey)) continue; // one suggestion per offending slot
    seenSlots.add(slotKey);

    const pool = poolById.get(warning.poolId);
    if (!pool) continue;
    // Reconstruct the slot definition the warning came from.
    const slots = pool.slotDefinitions ?? LEGACY_DEFAULT_SLOTS;
    const slot = slots.find((s) => s.allowedSkillIds.includes(warning.role));
    if (!slot) continue;

    const fromPerson = candidateByPerson.get(warning.personId);
    if (!fromPerson) continue;

    const poolMembers = new Set(
      pool.matches.flatMap((m) => [m.redRegistrationId, m.blueRegistrationId]),
    );

    for (const candidate of candidates) {
      if (candidate.personId === warning.personId) continue;
      if (!candidate.qualifications.some((q) => slot.allowedSkillIds.includes(q.role))) continue;
      // Not a fighter in this pool.
      if (candidate.fighterRegistrationIds.some((id) => poolMembers.has(id))) continue;
      // Not already assigned to this pool.
      if (assignments.some((a) => a.personId === candidate.personId && a.poolId === pool.poolId)) {
        continue;
      }
      // No time overlap with their existing assignments.
      const existingForCandidate = assignmentsByPerson.get(candidate.personId) ?? [];
      if (hasTimeOverlap(pool, existingForCandidate, poolById)) continue;
      // The swap must NOT introduce a new back-to-back chain for the candidate.
      if (wouldBeBackToBack(pool, existingForCandidate, poolById, pools)) continue;

      out.push({
        fromPoolId: warning.poolId,
        fromSlotIndex: slot.index,
        fromPersonId: fromPerson.personId,
        fromPersonName: fromPerson.personName,
        toPersonId: candidate.personId,
        toPersonName: candidate.personName,
        reason: 'breaks_back_to_back',
        detail: `Swap ${fromPerson.personName} → ${candidate.personName} to relieve back-to-back on ${pool.poolName}`,
      });
      break;
    }
  }

  return out;
}

function hasTimeOverlap(
  pool: PoolSlot,
  existing: RefereeAssignment[],
  poolById: Map<string, PoolSlot>,
): boolean {
  if (!pool.earliestStart || !pool.latestEnd) return false;
  const poolStart = new Date(pool.earliestStart).getTime();
  const poolEnd = new Date(pool.latestEnd).getTime();
  for (const a of existing) {
    const other = poolById.get(a.poolId);
    if (!other?.earliestStart || !other?.latestEnd) continue;
    const os = new Date(other.earliestStart).getTime();
    const oe = new Date(other.latestEnd).getTime();
    if (poolStart < oe && os < poolEnd) return true;
  }
  return false;
}

function wouldBeBackToBack(
  pool: PoolSlot,
  existing: RefereeAssignment[],
  poolById: Map<string, PoolSlot>,
  allPools: PoolSlot[],
): boolean {
  if (existing.length === 0) return false;
  const poolIndex = allPools.indexOf(pool);
  if (poolIndex < 0) return false;
  for (const a of existing) {
    const otherIdx = allPools.findIndex((p) => p.poolId === a.poolId);
    if (otherIdx < 0) continue;
    if (Math.abs(otherIdx - poolIndex) <= 1) return true;
  }
  // Silence unused-var lint — poolById may become useful in v2 (time-based adjacency).
  void poolById;
  return false;
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
  // Structural minimum so both produced `RefereeAssignment`s and seeded
  // prior assignments satisfy it — the filters only read poolId + personId.
  existingAssignments: ReadonlyArray<{ poolId: string; personId: string }>,
  settings: AssignmentSettings,
  personAssignmentCount: Map<string, number>,
  personAssignedPools: Map<string, string[]>,
  // Every pool in THIS run. The officiate-vs-fight, double-booking and
  // back-to-back rules all ask about pools other than the one being filled, so
  // the whole set has to reach them. It used to arrive through a module-level
  // variable that `assignRefereesWithPools` assigned on the way in, which made
  // the engine non-re-entrant: a second run reading it mid-flight judged its
  // slots against the first run's pools, and calling the exported
  // `assignReferees` directly left it holding whatever the last run put there —
  // or an empty array, which silently disables the officiate-vs-fight rule.
  allPools: PoolSlot[],
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

  // Slice 8: HARD filter — referee must be allowlisted for this pool's
  // tournament AND day. Undefined allowlists = legacy "no restriction".
  // pool.tournamentId / pool.dayIndex are optional for backwards
  // compatibility with pre-Slice-8 callers; missing pool metadata means
  // the matching dimension's filter is skipped.
  const available =
    (settings.enableAvailabilityRule ?? true)
      ? qualified.filter(({ candidate }) => {
          if (
            pool.tournamentId !== undefined &&
            candidate.availableTournamentIds !== undefined &&
            !candidate.availableTournamentIds.includes(pool.tournamentId)
          ) {
            return false;
          }
          if (
            pool.dayIndex !== undefined &&
            candidate.availableDayIndices !== undefined &&
            !candidate.availableDayIndices.includes(pool.dayIndex)
          ) {
            return false;
          }
          return true;
        })
      : qualified;

  if (available.length === 0) {
    rejectionReasons.push('all_qualified_unavailable_for_this_pool');
    return { assigned: null, warnings, rejectionReasons };
  }

  // Filter: not already assigned to this pool in any slot (HARD)
  const alreadyAssignedToPool = new Set(
    existingAssignments.filter((a) => a.poolId === pool.poolId).map((a) => a.personId),
  );

  const notAlreadyAssigned =
    (settings.enableTwoRolesRule ?? true)
      ? available.filter((q) => !alreadyAssignedToPool.has(q.candidate.personId))
      : available;

  if (notAlreadyAssigned.length === 0) {
    rejectionReasons.push('all_qualified_already_assigned_to_pool');
    return { assigned: null, warnings, rejectionReasons };
  }

  // Filter: HARD constraint — fighter cannot referee pool whose time
  // overlaps their match. Checked in two layers:
  //   1. pool.memberPersonIds — the pool's roster. Catches fighters
  //      even before per-match red/blue registration fields are wired
  //      (e.g. pre-bracket generation; matches[] may be empty).
  //   2. pool.matches[].red/blueRegistrationId — exact per-match
  //      registration match. Still needed for the cross-pool case
  //      where a fighter's match record references a registration ID
  //      tied to them but the membership table hasn't caught up.
  const noFighterOverlap =
    (settings.enableOwnPoolRule ?? true)
      ? notAlreadyAssigned.filter(({ candidate }) => {
          if (pool.memberPersonIds?.includes(candidate.personId)) {
            return false;
          }
          for (const match of pool.matches) {
            const isFighter =
              candidate.fighterRegistrationIds.includes(match.redRegistrationId) ||
              candidate.fighterRegistrationIds.includes(match.blueRegistrationId);
            if (isFighter) return false;
          }
          return true;
        })
      : notAlreadyAssigned;

  if (noFighterOverlap.length === 0) {
    rejectionReasons.push('all_qualified_are_fighters_in_this_pool');
    return { assigned: null, warnings, rejectionReasons };
  }

  // Filter: HARD constraint — referee cannot officiate a pool whose time
  // window overlaps a DIFFERENT pool they FIGHT in (parallel lices, any
  // tournament). The double-booking check below only sees officiating
  // assignments already made; without this, a fighter of parallel Pool 4
  // gets proposed as referee of Pool 1 at the same 11:00 window — the
  // exact conflict the assignment-board detector then flags. Looping all
  // pools (not just processed ones) also prevents conflicts with pools
  // assigned later in the run.
  const noParallelFighting = noFighterOverlap.filter(({ candidate }) => {
    if (!(settings.enableOfficiateVsFightRule ?? true)) return true; // rule disabled
    if (!pool.earliestStart || !pool.latestEnd) return true; // unscheduled — skip time check

    const poolStart = new Date(pool.earliestStart).getTime();
    const poolEnd = new Date(pool.latestEnd).getTime();

    for (const otherPool of allPools) {
      if (otherPool.poolId === pool.poolId) continue;
      if (!otherPool.earliestStart || !otherPool.latestEnd) continue;

      const otherStart = new Date(otherPool.earliestStart).getTime();
      const otherEnd = new Date(otherPool.latestEnd).getTime();
      if (!(poolStart < otherEnd && otherStart < poolEnd)) continue;

      const fightsThere =
        otherPool.memberPersonIds?.includes(candidate.personId) ||
        otherPool.matches.some(
          (m) =>
            candidate.fighterRegistrationIds.includes(m.redRegistrationId) ||
            candidate.fighterRegistrationIds.includes(m.blueRegistrationId),
        );
      if (fightsThere) return false;
    }
    return true;
  });

  if (noParallelFighting.length === 0) {
    rejectionReasons.push('all_qualified_fighting_in_parallel_pool');
    return { assigned: null, warnings, rejectionReasons };
  }

  // Filter: HARD constraint — referee cannot be assigned to two pools at the same time
  const noTimeOverlap = noParallelFighting.filter(({ candidate }) => {
    if (!(settings.enableDoubleBookedRule ?? true)) return true; // rule disabled
    if (!pool.earliestStart || !pool.latestEnd) return true; // unscheduled — skip time check

    const poolStart = new Date(pool.earliestStart).getTime();
    const poolEnd = new Date(pool.latestEnd).getTime();

    for (const existing of existingAssignments) {
      if (existing.personId !== candidate.personId) continue;

      const assignedPool = allPools.find((p) => p.poolId === existing.poolId);
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
        const poolIndex = allPools.indexOf(pool);
        const isBackToBack = assignedPools.some((pid) => {
          const prevIndex = allPools.findIndex((p) => p.poolId === pid);
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

/**
 * Alias of {@link assignReferees}, kept because every caller uses this name.
 *
 * It used to do something: it parked its pool list in a module-level variable
 * for `assignSlot` to read. That made the engine non-re-entrant, so the list is
 * threaded through as an argument now and the two entry points are the same
 * function. Nothing here holds state between runs.
 */
export function assignRefereesWithPools(
  pools: PoolSlot[],
  candidates: RefereeCandidate[],
  settings: AssignmentSettings,
  priorAssignments: PriorAssignment[] = [],
): AssignmentResult {
  return assignReferees(pools, candidates, settings, priorAssignments);
}
