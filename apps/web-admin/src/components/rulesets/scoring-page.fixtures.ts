/**
 * Scoring rulesets as the API answers them, for the scoring pages' save tests (the page harness is
 * `penalty-page.fixtures.tsx`'s `openPenaltyPage`: reads answered by path, saves written down).
 * The stored values are MARKERS no engine default holds: a page that filled a field in instead of
 * keeping the ruleset's own value is seen.
 */

/** A score formula the form accepts as it is. */
export const VICTORIES = { type: 'var', name: 'victories' };

/** A best-of the match format box does not show: a Save must keep it as stored. */
export const BEST_OF_MARKER = { pool: 3 };

/** The row fields every scoring ruleset carries. */
function base(id: string, code: string): Record<string, unknown> {
  return {
    id,
    code,
    version: '1.0.0',
    name: `Ruleset ${id}`,
    description: null,
    status: 'published',
    score_formula: {},
    constants: null,
    tiebreakers: [],
    match_format_defaults: null,
    double_penalty_formula: null,
    targets: null,
    has_afterblow: false,
    afterblow_mode: null,
    afterblow_valuation: null,
    afterblow_fixed_value: null,
    tf_config: null,
    base_code: null,
    base_version: null,
    is_default: false,
    is_system: false,
    owner_organization_id: 'org-1',
    public_visibility: false,
    submitted_for_review_at: null,
    rejected_reason: null,
    lineage: null,
  };
}

/** A club's own formula ruleset: cap 7 and a best-of of its own. */
export function formulaRow(): Record<string, unknown> {
  return {
    ...base('rs-formula', 'custom_house-1'),
    score_formula: VICTORIES,
    tiebreakers: [{ variable: 'victories', direction: 'desc' }],
    match_format_defaults: { pointCap: 7, bestOf: BEST_OF_MARKER },
    targets: [{ name: 'Hit', value: 1 }],
  };
}

/** The tf_config of a club's TF_v1 copy: win bonus 5, three targets, cap 7. */
export const FORK_TF_CONFIG = {
  winBonus: 5,
  targets: [
    { name: 'Head', value: 3 },
    { name: 'Body', value: 2 },
    { name: 'Limb', value: 1 },
  ],
  targetValues: { deepTarget: 3, shallowTarget: 2 },
  matchFormat: { pointCap: 7 },
};

/** A club's copy of TF_v1 ("Customise this format", or a Clone). */
export function tfForkRow(): Record<string, unknown> {
  return {
    ...base('rs-fork', 'custom_tf_v1_fork_abc'),
    base_code: 'TF_v1',
    base_version: '1.0.0',
    tf_config: FORK_TF_CONFIG,
    targets: FORK_TF_CONFIG.targets,
    has_afterblow: true,
    afterblow_mode: 'deductive',
    afterblow_valuation: 'fixed',
    afterblow_fixed_value: 1,
  };
}

/** TF_v1's own row, holding one platform-admin change (the pool time). */
export function tfV1Row(): Record<string, unknown> {
  return {
    ...base('rs-tf', 'TF_v1'),
    is_system: true,
    owner_organization_id: null,
    tf_config: { matchFormat: { timeLimitsSeconds: { pool: 120 } } },
    targets: [
      { name: 'Deep', value: 2 },
      { name: 'Shallow', value: 1 },
    ],
  };
}
