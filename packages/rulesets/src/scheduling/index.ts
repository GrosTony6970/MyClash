/**
 * @myclash/rulesets/scheduling — pool generation and scheduling utilities
 */
export { snakeSeed, sortBySkill, computePoolSizes } from './snake-seeding';
export type { Fighter, PoolAssignment } from './snake-seeding';

export { localSearch, computeCost, buildCostReport } from './local-search';
export type { PoolAssignmentSettings, CostReport } from './local-search';
