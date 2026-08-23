/**
 * @myclash/rulesets/scheduling — who may work a Pool.
 *
 * What is left here RESOLVES: the referee assigner reads staff availability,
 * roles and prior workload, and the conflict check reads which Person sits
 * behind a Registration. Both need knowledge the bout itself does not carry.
 *
 * The shape of the competition — pools, seeding, brackets and Swiss rounds —
 * moved to `@myclash/rules`, which has no dependencies and which the scoring pad
 * can therefore reach offline.
 */
export { detectFighterRefereeConflicts } from './conflict-check';
export type {
  ScheduledMatch as ConflictScheduledMatch,
  RefereeAssignment as ConflictRefereeAssignment,
  RegistrationPersonMap,
  FighterRefereeConflict,
  ConflictCheckResult,
} from './conflict-check';

export { assignReferees, assignRefereesWithPools } from './referee-assigner';
export type {
  RefereeRole,
  RefereeCandidate,
  PoolSlot as RefereePoolSlot,
  AssignmentSettings as RefereeAssignmentSettings,
  RefereeAssignment,
  PriorAssignment,
  MissingAssignment,
  AssignmentWarning,
  AssignmentResult,
} from './referee-assigner';
