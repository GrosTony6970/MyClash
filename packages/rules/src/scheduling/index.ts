/**
 * @myclash/rules/scheduling — how a competition's Matches are laid out.
 *
 * Pool round-robins, seeding, single- and double-elimination brackets and Swiss
 * rounds. Every function here APPLIES a shape to a known field of Fighters, so
 * it belongs beside the rest of the deterministic core rather than beside zod.
 *
 * `referee-assigner` and `conflict-check` stayed in `@myclash/rulesets`: they
 * RESOLVE — they read staff availability and registration identities and decide
 * who may work a Pool.
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

export { groupBracketBranches } from './bracket-branches';
export type { BracketSlotInput, BranchUnit, GroupBracketBranchesResult } from './bracket-branches';
