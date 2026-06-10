/**
 * The scoring ruleset (TF) + penalty ruleset (FFAMHE built-in) a brand-new
 * tournament should start with, picked from the fetched catalog lists.
 *
 * Returning the TF row's real `version` fixes the wizard's stale `1` default
 * (the API ships TF at `1.0.0`, so a hardcoded `TF_v1:1` never matched the
 * `<option>` value and TF was silently left unselected).
 */
export interface RulesetChoice {
  code: string;
  version: string;
}

export function pickWizardDefaults(
  rulesets: { code: string; version: string }[],
  penalties: { id: string; built_in?: boolean; code?: string }[],
): { ruleset: RulesetChoice | null; penaltyId: string | null } {
  const tf = rulesets.find((r) => r.code === 'TF_v1') ?? null;
  const penalty =
    penalties.find((p) => p.built_in) ?? penalties.find((p) => p.code === 'ffamhe_tf_2026') ?? null;
  return {
    ruleset: tf ? { code: tf.code, version: tf.version } : null,
    penaltyId: penalty?.id ?? null,
  };
}
