/**
 * apps/api/src/modules/events/ruleset-defaults.ts
 *
 * Returns the default `ruleset_config` JSONB shape for a given ruleset code +
 * version.  Used by `updateTournament` when a `rulesetCode` switch wipes the
 * stale config of the previous ruleset and seeds the new one from scratch.
 *
 * Design decision — hardcoded map, not registry lookup:
 *   The `Ruleset` interface (packages/rulesets/src/types.ts) does NOT expose a
 *   `defaults` field, and adding one to the interface + all three implementations
 *   would be invasive for a purely API-layer concern.  Instead, we import the
 *   already-exported `*DefaultConfig` constants directly.  This keeps the
 *   rulesets package unchanged and makes the defaults statically visible here.
 *
 *   Version aliases: the registered versions are "1.0.0" for all built-in
 *   rulesets, but callers (DTO, wizard, tests) may pass the shorthand "1".
 *   We normalise both to the same defaults entry.
 */
import { TFv1DefaultConfig } from '@myclash/rulesets';
import { GenericPointsCapDefaultConfig } from '@myclash/rulesets';

type DefaultsMap = Record<string, Record<string, unknown>>;

/**
 * Canonical defaults keyed by `${code}:${normalisedVersion}`.
 * "1" and "1.0.0" are treated as the same version for all built-in rulesets.
 */
const RULESET_DEFAULTS: DefaultsMap = {
  'TF_v1:1': TFv1DefaultConfig as Record<string, unknown>,
  'TF_v1:1.0.0': TFv1DefaultConfig as Record<string, unknown>,
  'TF_v1_no_afterblow:1': TFv1DefaultConfig as Record<string, unknown>,
  'TF_v1_no_afterblow:1.0.0': TFv1DefaultConfig as Record<string, unknown>,
  'Generic_PointsCap:1': GenericPointsCapDefaultConfig as Record<string, unknown>,
  'Generic_PointsCap:1.0.0': GenericPointsCapDefaultConfig as Record<string, unknown>,
};

/**
 * Returns a *shallow copy* of the default `ruleset_config` for the given
 * ruleset code + version.  Falls back to an empty object if the ruleset is
 * unknown (e.g. a DB-authored FormulaRuleset whose defaults aren't statically
 * known here).
 */
export function defaultRulesetConfigFor(code: string, version: string): Record<string, unknown> {
  const key = `${code}:${version}`;
  const defaults = RULESET_DEFAULTS[key];
  return defaults ? { ...defaults } : {};
}
