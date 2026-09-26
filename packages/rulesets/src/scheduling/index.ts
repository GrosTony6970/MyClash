/**
 * @myclash/rulesets/scheduling — who may work a Pool.
 *
 * What is left here RESOLVES: the referee assigner reads staff availability,
 * roles and prior workload. It needs knowledge the bout itself does not carry.
 *
 * The one referee checker (ADR-016) is NOT re-exported here: it is imported by
 * its own path, `@myclash/rulesets/scheduling/referee-checker`, because this
 * barrel is CommonJS and would drag the assigner into the admin board's bundle.
 *
 * The shape of the competition — pools, seeding, brackets and Swiss rounds —
 * moved to `@myclash/rules`, which has no dependencies and which the scoring pad
 * can therefore reach offline.
 */

export { assignReferees, assignRefereesWithPools } from './referee-assigner';
export type {
  RefereeRole,
  RefereeCandidate,
  PoolSlot as RefereePoolSlot,
  AssignmentSettings as RefereeAssignmentSettings,
  RefereeAssignment,
  PriorAssignment,
  MissingAssignment,
  EmptySlotReason,
  EngineRules as RefereeEngineRules,
  AssignmentResult,
} from './referee-assigner';
