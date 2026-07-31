/**
 * @myclash/rulesets/scheduling — pool generation and scheduling utilities
 */
export { snakeSeed, sortBySkill, computePoolSizes } from './snake-seeding';
export type { Fighter, PoolAssignment } from './snake-seeding';

export { localSearch, computeCost, buildCostReport, mulberry32 } from './local-search';
export type { PoolAssignmentSettings, CostReport } from './local-search';

export { bergerSchedule, totalMatches, totalRounds } from './berger';
export type { BergerMatch, BergerScheduleOptions } from './berger';

export {
  MAX_SINGLE_ELIM_BRACKET_SIZE,
  singleElimBracket,
  totalBracketMatches,
} from './single-elim';
export type { BracketSlot, SingleElimBracket, SingleElimOptions } from './single-elim';

export {
  MAX_DOUBLE_ELIM_BRACKET_SIZE,
  doubleElimBracket,
  totalDoubleElimMatches,
  resolveDoubleElimShape,
} from './double-elim';
export type {
  DoubleElimBracket,
  DoubleElimSlot,
  DoubleElimOptions,
  DoubleElimShape,
  SecondChanceTarget,
  SlotSourceType,
} from './double-elim';

export { bandsOf, planSwissRound, recommendedRoundCount } from './swiss';
export type {
  SwissGrouping,
  SwissPairing,
  SwissPairingMethod,
  SwissPlayer,
  SwissRoundPlan,
  SwissWarning,
  SwissWarningCode,
} from './swiss';

export { detectFighterRefereeConflicts } from './conflict-check';
export type {
  ScheduledMatch as ConflictScheduledMatch,
  RefereeAssignment as ConflictRefereeAssignment,
  RegistrationPersonMap,
  FighterRefereeConflict,
  ConflictCheckResult,
} from './conflict-check';

export { groupBracketBranches } from './bracket-branches';
export type { BracketSlotInput, BranchUnit, GroupBracketBranchesResult } from './bracket-branches';

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
