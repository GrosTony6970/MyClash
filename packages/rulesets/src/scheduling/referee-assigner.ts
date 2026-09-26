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
 * seats of one unit in the same role (`all_qualified_already_seated`).
 *
 * Among the Fine candidates: higher rating first, then the less loaded.
 *
 * Returns: { assignments, missing }
 */

import {
  checkReferee,
  REFEREE_REASON_CODES,
  type RefereeAvailability,
  type RefereeCommitment,
  type RefereeReasonCode,
  type RefereeSwitches,
  type RefereeTarget,
} from './referee-checker';

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
  /** Active qualifications for this event. `role` is any skill_id. */
  qualifications: Array<{ role: RefereeRole; rating: number | null }>;
}

/** One board unit to staff: a Pool, a Swiss round on one piste, or a bracket bout. */
export interface PoolSlot {
  poolId: string;
  poolName: string;
  /** The unit as the checker judges it; the engine adds the role. */
  target: Omit<RefereeTarget, 'role'>;
  /** The data name a proposal's duty carries (`unitLabel`). */
  label: string;
  /**
   * Slot definitions for this pool (typically from `StaffingService`).
   * Optional — when absent the engine uses `LEGACY_DEFAULT_SLOTS`.
   */
  slotDefinitions?: SlotDefinition[];
  /**
   * R4 metadata flag — marks bracket "pools" that represent medal-set matches.
   * The engine doesn't dispatch on this; it surfaces back through
   * `RefereeAssignment.isFinals` so consumers can group results by phase-type.
   */
  isFinals?: boolean;
}

/** How the engine ranks the candidates the checker left Fine. */
export interface AssignmentSettings {
  ratingBasedOrdering: boolean;
  workloadBalance: boolean;
}

/** What the checker needs besides a target: everything the Event already holds. */
export interface EngineRules {
  /**
   * Each person's commitments — fights, Workshops, and the duties this run keeps
   * (manual rows; never the auto rows the run replaces).
   */
  commitmentsByPerson: ReadonlyMap<string, readonly RefereeCommitment[]>;
  availabilityOf: (personId: string) => RefereeAvailability;
  switches: RefereeSwitches;
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

/** Why a slot stayed empty: a seat rule, or the checker's codes. */
export type EmptySlotReason =
  'no_qualified_users' | 'all_qualified_already_seated' | RefereeReasonCode;

export interface MissingAssignment {
  poolId: string;
  poolName: string;
  slotIndex: number;
  /** Primary skill_id for display (= slot.allowedSkillIds[0]). */
  role: RefereeRole;
  rejectionReasons: EmptySlotReason[];
  /** R4: mirrors PoolSlot.isFinals (same rationale as RefereeAssignment). */
  isFinals?: boolean;
}

export interface AssignmentResult {
  assignments: RefereeAssignment[];
  missing: MissingAssignment[];
}

/**
 * An assignment that already exists on the board (typically a human's
 * manual pick): the engine won't propose into the same `(poolId, role)` slot,
 * and it counts toward the person's workload. Its clashes reach the checker
 * through `EngineRules.commitmentsByPerson`.
 */
export interface PriorAssignment {
  poolId: string;
  role: RefereeRole;
  personId: string;
}

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
    const verdict = checkReferee({
      personId: candidate.personId,
      target: { ...pool.target, role: matchedQual.role },
      commitments: [
        ...(rules.commitmentsByPerson.get(candidate.personId) ?? []),
        ...(state.proposals.get(candidate.personId) ?? []),
      ],
      availability: rules.availabilityOf(candidate.personId),
      switches: rules.switches,
    });
    for (const r of verdict.reasons) refused.add(r.code);
    return verdict.level === 'fine';
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
