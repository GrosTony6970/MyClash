/**
 * @myclash/rulesets/scheduling — pool generation and scheduling utilities
 */
export { snakeSeed, sortBySkill, computePoolSizes } from './snake-seeding';
export type { Fighter, PoolAssignment } from './snake-seeding';

export { localSearch, computeCost, buildCostReport } from './local-search';
export type { PoolAssignmentSettings, CostReport } from './local-search';

export { bergerSchedule, totalMatches, totalRounds } from './berger';
export type { BergerMatch, BergerScheduleOptions } from './berger';

export { singleElimBracket, totalBracketMatches } from './single-elim';
export type { BracketSlot, SingleElimBracket, SingleElimOptions } from './single-elim';

export { detectFighterRefereeConflicts } from './conflict-check';
export type {
  ScheduledMatch as ConflictScheduledMatch,
  RefereeAssignment as ConflictRefereeAssignment,
  RegistrationPersonMap,
  FighterRefereeConflict,
  ConflictCheckResult,
} from './conflict-check';
