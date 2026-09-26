/**
 * referee-checker-types.ts — the one referee checker's vocabulary (ADR-016): the reason
 * codes and their levels, what a person is doing (commitments), what they would referee
 * (a target), and what the checker answers. The rules are in `referee-checker.ts`, which
 * re-exports all of this, so every caller imports one deep path.
 *
 * Pure types and constants: no I/O.
 */
import type { TimeWindowMs } from '@myclash/schedule-core';

export const REFEREE_REASON_CODES = [
  'own_match',
  'fights_overlap',
  'referees_overlap',
  'teaches_overlap',
  'outside_availability',
  'own_pool',
  'own_pool_span',
  'two_roles',
  'attends_overlap',
  'rest',
  'cap',
] as const;

export type RefereeReasonCode = (typeof REFEREE_REASON_CODES)[number];
export type RefereeLevel = 'impossible' | 'discouraged';

const IMPOSSIBLE: ReadonlySet<RefereeReasonCode> = new Set<RefereeReasonCode>([
  'own_match',
  'fights_overlap',
  'referees_overlap',
  'teaches_overlap',
  'outside_availability',
]);

export function levelOf(code: RefereeReasonCode): RefereeLevel {
  return IMPOSSIBLE.has(code) ? 'impossible' : 'discouraged';
}

interface CommitmentBase {
  /** `global_persons.id`. */
  personId: string;
  window: TimeWindowMs | null;
  /** The data name a screen shows and a confirm stores. */
  label: string;
}

/**
 * Something a person is doing. A fight is one bout; a fight-pool is the whole group a
 * person fights in — a Pool, or a Swiss round across its pistes — as its hull, and it
 * carries the two Pool rules; a referee duty sits on a board unit (a Pool, a Swiss round
 * on one piste, a bracket bout).
 *
 * A fight's `groupId` is the group whose span the bout is part of (the Pool, or the Swiss
 * round). A bout of that group on another piste at the same time is still two places at
 * once: the group decides the two Pool rules, never whether an overlap counts.
 */
export type RefereeCommitment =
  | (CommitmentBase & {
      kind: 'fight';
      matchId: string;
      groupId: string | null;
    })
  | (CommitmentBase & { kind: 'fight-pool'; groupId: string })
  | (CommitmentBase & {
      kind: 'referee';
      unitId: string;
      poolId: string | null;
      matchId: string | null;
      role: string;
      /** Every bout the duty covers: a Pool-scoped row, all of its Pool's; a bout row, its one. */
      matchIds: readonly string[];
      /** The duty's unit's day slot (`referee-load.ts`); null for a bracket bout or untimed. */
      slot: number | null;
      /** Its day on the Event clock; null when it has no time. */
      dayIndex: number | null;
    })
  | (CommitmentBase & { kind: 'teach' | 'attend'; sessionId: string });

/** What someone would referee. */
export interface RefereeTarget {
  /** 'pool': one Pool-scoped duty over the whole Pool. 'match': duties on these bouts. */
  scope: 'pool' | 'match';
  /** The board unit. Duties on the same unit are "on" the target (two roles, not two places). */
  unitId: string;
  /** The real Pool the unit or bout belongs to, when there is one. */
  poolId: string | null;
  /** The group whose fighters make this "their own" (a Pool, a Swiss round); null for a bracket bout. */
  groupId: string | null;
  matchIds: readonly string[];
  window: TimeWindowMs | null;
  role: string;
  tournamentId: string;
  /** The target's day on the Event clock, or null when it has no time. */
  dayIndex: number | null;
  /** Its unit's day slot (`referee-load.ts`); null for a bracket bout or untimed. */
  slot: number | null;
}

/** Declared availability; null = no restriction on that axis. */
export interface RefereeAvailability {
  tournamentIds: readonly string[] | null;
  dayIndices: readonly number[] | null;
}

export const ANY_AVAILABILITY: RefereeAvailability = { tournamentIds: null, dayIndices: null };

/** The Discouraged rules' per-Event switches. The Impossible rules have none. */
export interface RefereeSwitches {
  ownPool: boolean;
  ownPoolSpan: boolean;
  twoRoles: boolean;
  attendWorkshop: boolean;
  /** Slots of rest between two duties of a day; 0 = the rule is off. */
  restSlots: number;
  /** Most bouts a person referees in one day; 0 = no cap. */
  maxBoutsPerDay: number;
}

export interface RefereeReason {
  code: RefereeReasonCode;
  level: RefereeLevel;
  /**
   * What it clashes with. Null for availability. For the cap it is the day, and its label is
   * the day's bout total: a confirm at 7 does not cover 8.
   */
  against: {
    kind: 'match' | 'pool' | 'unit' | 'workshop' | 'day';
    id: string;
    label: string;
  } | null;
  /** True when the organiser already confirmed over this reason (ruling 135). */
  confirmed: boolean;
}

export interface RefereeVerdict {
  level: RefereeLevel | 'fine';
  reasons: RefereeReason[];
}

/** What a confirm stores in `referee_assignments.conflicts_jsonb`. */
export interface StoredRefereeReason {
  code: RefereeReasonCode;
  label: string;
}
