export interface WizardTournamentInput {
  id: string;
  name: string | null;
  slug: string | null;
  ruleset_code: string | null;
  ruleset_version: string | null;
  /** JSONB column on `tournaments`. Carries the canonical *_json
   *  suffix as it ships from `GET /api/v1/tournaments/:id`; reading
   *  it as `scoring_config` (no suffix) silently returned undefined
   *  and dropped the user back to Step 3 on every reload. */
  scoring_config_json: Record<string, unknown> | null;
  ruleset_config: Record<string, unknown> | null;
  lock_config_json: Record<string, unknown> | null;
  status: string;
}

/**
 * Returns the wizard step number (1-4) the user should resume on, or `null`
 * if every step has been completed at least once.
 *
 * Heuristic — driven by which JSONB blobs have been written to. Operators
 * can always click step indicators to jump back; this function just decides
 * the DEFAULT step for `Resume setup` and the wizard auto-open.
 */
export function computeWizardStep(row: WizardTournamentInput): 1 | 2 | 3 | 4 | null {
  if (!row.name || !row.slug || !row.ruleset_code) return 1;
  const scoring = row.scoring_config_json ?? {};
  const ruleset = row.ruleset_config ?? {};
  const matchFormat = (ruleset as { matchFormat?: Record<string, unknown> }).matchFormat ?? {};
  if (!('pointCap' in matchFormat)) return 2;
  const buttons = (scoring as { buttons?: { clean?: unknown[] } }).buttons;
  if (!buttons || !Array.isArray(buttons.clean) || buttons.clean.length === 0) return 3;
  // Advanced is "done" if EITHER ruleset_config has been touched OR
  // lock_config_json is non-default. Both being default means step 4
  // wasn't visited.
  const rulesetTouched = Object.keys(ruleset).length > 0;
  const lockTouched = row.lock_config_json != null && Object.keys(row.lock_config_json).length > 0;
  if (!rulesetTouched && !lockTouched) return 4;
  return null;
}
