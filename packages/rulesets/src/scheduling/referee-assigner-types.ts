/**
 * referee-assigner-types.ts — what the auto-assign engine (`referee-assigner.ts`) takes and
 * returns. The engine re-exports all of this, so callers import one path.
 *
 * Pure types and constants: no I/O.
 */
import type {
  RefereeAvailability,
  RefereeCommitment,
  RefereeReasonCode,
  RefereeSwitches,
  RefereeTarget,
} from './referee-checker';

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
