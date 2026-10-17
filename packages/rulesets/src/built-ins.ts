/**
 * Every coded engine the platform runs, each version of it (ruling "TF_v1
 * version", 2026-10-16: bump the version when an engine's decision changes, and
 * keep the old engine registered). The API registers this list, and the test of
 * the decision editions runs every entry: a version added here with no cases
 * there fails it.
 */
import type { Ruleset } from './types';
import { TF_v1, TF_v1_1_0_0 } from './tf_v1';
import { Generic_PointsCap, Generic_PointsCap_1_0_0 } from './generic_points_cap';

export const BUILT_IN_RULESETS: readonly Ruleset[] = [
  TF_v1_1_0_0,
  TF_v1,
  Generic_PointsCap_1_0_0,
  Generic_PointsCap,
];
