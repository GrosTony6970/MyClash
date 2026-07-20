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
  /**
   * Highest wizard step completed, recorded by each step's save (migration
   * 0144). NULL on rows created before tracking existed — those fall back to
   * the legacy heuristic below.
   */
  wizard_step?: number | null;
  status: string;
}

/**
 * Returns the wizard step number (1-4) the user should resume on, or `null`
 * if every step has been completed at least once.
 *
 * Prefers the RECORDED step. The legacy heuristic below inferred progress from
 * which JSONB blobs had been written, which cannot work because the server
 * writes them itself:
 *
 *   - `ruleset_config` is seeded at create from the ruleset defaults, and those
 *     contain `matchFormat.pointCap` — the Step-2 marker is satisfied the
 *     instant the row exists, which is also why the Step-4 branch is
 *     unreachable (see the NOTE in this file's test).
 *   - `normalizeTournamentScoringConfig` backfills buttons AND display from
 *     DEFAULT_SCORING_CONFIG on EVERY scoringConfig PATCH, and Step 2 sends
 *     one — so the Step-3 marker is satisfied by a step that is not Step 3.
 *
 * So once Step 2 saved, this could only return null and "Resume setup"
 * vanished from a tournament whose display and advanced settings were never
 * opened. No other key substitutes: `display` is backfilled too.
 *
 * Operators can always click step indicators to jump back; this function just
 * decides the DEFAULT step for `Resume setup` and the wizard auto-open.
 */
export function computeWizardStep(row: WizardTournamentInput): 1 | 2 | 3 | 4 | null {
  if (!row.name || !row.slug || !row.ruleset_code) return 1;

  const recorded = row.wizard_step;
  if (typeof recorded === 'number' && recorded >= 1) {
    return recorded >= 4 ? null : ((recorded + 1) as 2 | 3 | 4);
  }

  // ── legacy fallback, for rows predating wizard_step ───────────────────────
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
