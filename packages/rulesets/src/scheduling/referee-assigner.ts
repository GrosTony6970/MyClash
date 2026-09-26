/**
 * referee-assigner.ts — T-903 + R3 of the Staffing overhaul, W1.3 of ADR-016
 *
 * Pure-function engine for referee auto-assignment.
 * Implements ARCHITECTURE.md §11quater.2.
 *
 * R3 generalisation:
 *   - `RefereeRole` is any `referee_skills.id` (legacy or custom).
 *   - Each `PoolSlot` carries `slotDefinitions[]` describing the slots to fill;
 *     a slot can list several `allowedSkillIds`, and a candidate is scored
 *     against their best matching qualification.
 *   - When `slotDefinitions` is omitted, the engine falls back to
 *     `LEGACY_DEFAULT_SLOTS` (the three hard-coded roles).
 *
 * Who may take a slot is not decided here. Every candidate is put to the one
 * referee checker (`referee-checker.ts`, ADR-016) — the same question the picker,
 * Assign and every other door ask — with the run's own proposals so far counted
 * as duties. Only a Fine candidate is picked: the engine never proposes anything
 * the organiser would have to confirm (Discouraged) or could not assign at all
 * (Impossible). An empty slot says why by the checker's codes.
 *
 * Two rules stay here because they are about seats, not clashes: a candidate needs
 * a qualification the slot allows (`no_qualified_users`), and nobody takes two
 * seats of one unit in the same role (`all_qualified_already_seated`). And the
 * engine never proposes someone for a Pool or Swiss round they fight in, even with
 * the own-Pool rule switched off (ruling 140): that switch lets the organiser do it
 * by hand. Such a slot says `own_pool`.
 *
 * Among the Fine candidates: higher rating first, then the less loaded.
 *
 * Returns: { assignments, missing }
 */

import {
  checkReferee,
  REFEREE_REASON_CODES,
  type RefereeCommitment,
  type RefereeReasonCode,
  type RefereeTarget,
} from './referee-checker';
import {
  LEGACY_DEFAULT_SLOTS,
  type AssignmentResult,
  type AssignmentSettings,
  type EmptySlotReason,
  type EngineRules,
  type MissingAssignment,
  type PoolSlot,
  type PriorAssignment,
  type RefereeAssignment,
  type RefereeCandidate,
  type RefereeRole,
  type SlotDefinition,
} from './referee-assigner-types';

export * from './referee-assigner-types';

// ── Implementation ────────────────────────────────────────────────────────────

/** The run so far: whose duties each person holds, and who sits in which role where. */
interface RunState {
  proposals: Map<string, RefereeCommitment[]>;
  /** Per unit, `personId|role` of every seat taken (priors and proposals). */
  seated: Map<string, Set<string>>;
  workload: Map<string, number>;
}

const seatKey = (personId: string, role: string) => `${personId}|${role}`;

export function assignReferees(
  pools: PoolSlot[],
  candidates: RefereeCandidate[],
  settings: AssignmentSettings,
  rules: EngineRules,
  priorAssignments: PriorAssignment[] = [],
): AssignmentResult {
  // Newly-produced assignments — the only ones returned (priors already
  // live on the board and are re-applied by the persistence layer).
  const assignments: RefereeAssignment[] = [];
  const missing: MissingAssignment[] = [];
  const state: RunState = { proposals: new Map(), seated: new Map(), workload: new Map() };

  for (const prior of priorAssignments) {
    seat(state, prior.poolId, prior.personId, prior.role);
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

      const result = assignSlot(pool, slot, candidates, settings, rules, state);
      if (result.assigned) {
        const stamped: RefereeAssignment = pool.isFinals
          ? { ...result.assigned, isFinals: true }
          : result.assigned;
        assignments.push(stamped);
        propose(state, pool, stamped);
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

  return { assignments, missing };
}

function seat(state: RunState, poolId: string, personId: string, role: string): void {
  const people = state.seated.get(poolId) ?? new Set<string>();
  people.add(seatKey(personId, role));
  state.seated.set(poolId, people);
  state.workload.set(personId, (state.workload.get(personId) ?? 0) + 1);
}

/** A proposal is a duty from now on: the next candidate is judged against it. */
function propose(state: RunState, pool: PoolSlot, assignment: RefereeAssignment): void {
  seat(state, pool.poolId, assignment.personId, assignment.role);
  const list = state.proposals.get(assignment.personId) ?? [];
  list.push({
    kind: 'referee',
    personId: assignment.personId,
    unitId: pool.target.unitId,
    poolId: pool.target.poolId,
    matchId: null,
    role: assignment.role,
    matchIds: pool.target.matchIds,
    slot: pool.target.slot,
    dayIndex: pool.target.dayIndex,
    window: pool.target.window,
    label: pool.label,
  });
  state.proposals.set(assignment.personId, list);
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

/**
 * Whether the person fights in the unit's group (its Pool or Swiss round). Everyone who fights a
 * bout of a group holds that group's fight-pool; a bracket bout has no group, and fighting it is
 * already `own_match`.
 */
function fightsIn(
  commitments: readonly RefereeCommitment[],
  target: Omit<RefereeTarget, 'role'>,
): boolean {
  return commitments.some(
    (c) => c.kind === 'fight-pool' && target.groupId !== null && c.groupId === target.groupId,
  );
}

/**
 * Why the engine may not propose this person in this role on this unit — the checker's
 * reasons over their commitments and the run's proposals so far — or none when Fine.
 */
function refusals(
  personId: string,
  role: string,
  pool: PoolSlot,
  rules: EngineRules,
  state: RunState,
): RefereeReasonCode[] {
  const mine = rules.commitmentsByPerson.get(personId) ?? [];
  // Ruling 140: never proposed for a group one fights in, whatever the own-Pool switch —
  // that switch lets an organiser do it by hand, not the engine on its own.
  if (fightsIn(mine, pool.target)) return ['own_pool'];
  const verdict = checkReferee({
    personId,
    target: { ...pool.target, role },
    commitments: [...mine, ...(state.proposals.get(personId) ?? [])],
    availability: rules.availabilityOf(personId),
    switches: rules.switches,
  });
  return verdict.level === 'fine' ? [] : verdict.reasons.map((r) => r.code);
}

interface SlotAssignmentResult {
  assigned: RefereeAssignment | null;
  rejectionReasons: EmptySlotReason[];
}

function assignSlot(
  pool: PoolSlot,
  slot: SlotDefinition,
  candidates: RefereeCandidate[],
  settings: AssignmentSettings,
  rules: EngineRules,
  state: RunState,
): SlotAssignmentResult {
  const qualified = candidates.flatMap((candidate) => {
    const matchedQual = bestMatchingQual(candidate, slot);
    return matchedQual ? [{ candidate, matchedQual }] : [];
  });
  if (qualified.length === 0) return { assigned: null, rejectionReasons: ['no_qualified_users'] };

  // A seat rule, not a clash: the checker says nothing about the same role twice on one
  // unit. Two different roles are its `two_roles`, with its switch.
  const seatedHere = state.seated.get(pool.poolId);
  const free = qualified.filter(
    ({ candidate, matchedQual }) => !seatedHere?.has(seatKey(candidate.personId, matchedQual.role)),
  );
  if (free.length === 0) {
    return { assigned: null, rejectionReasons: ['all_qualified_already_seated'] };
  }

  const refused = new Set<RefereeReasonCode>();
  const fine = free.filter(({ candidate, matchedQual }) => {
    const reasons = refusals(candidate.personId, matchedQual.role, pool, rules, state);
    for (const code of reasons) refused.add(code);
    return reasons.length === 0;
  });
  if (fine.length === 0) {
    return {
      assigned: null,
      rejectionReasons: REFEREE_REASON_CODES.filter((code) => refused.has(code)),
    };
  }

  // Score (lower = better).
  const score = ({ candidate, matchedQual }: (typeof fine)[number]) =>
    (settings.ratingBasedOrdering ? -(matchedQual.rating ?? 0) * 10 : 0) +
    (settings.workloadBalance ? (state.workload.get(candidate.personId) ?? 0) * 5 : 0);
  const best = [...fine].sort((a, b) => score(a) - score(b))[0]!;

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
  rules: EngineRules,
  priorAssignments: PriorAssignment[] = [],
): AssignmentResult {
  return assignReferees(pools, candidates, settings, rules, priorAssignments);
}
