-- Migration 0052: per-version snapshot history for custom_rulesets.
--
-- Today the custom_rulesets row is mutable in place: every save overwrites the
-- previous state. Once a tournament has pinned (ruleset_code, ruleset_version),
-- any further edit silently changes how that tournament scores. This table
-- snapshots the published payload of each version so:
--
--   1. Tournaments referencing an older version keep scoring with their pinned
--      snapshot (the RulesetResolver looks here first for non-system codes).
--   2. Rollback to a previous version is a copy-snapshot-onto-parent-row
--      operation, not a destructive overwrite.
--   3. `is_frozen` flips to TRUE the moment a tournament references the
--      (code, version) pair, after which the version is immutable.

CREATE TABLE IF NOT EXISTS custom_ruleset_versions (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  custom_ruleset_id      UUID NOT NULL REFERENCES custom_rulesets(id) ON DELETE CASCADE,
  version                TEXT NOT NULL,
  name                   TEXT NOT NULL,
  description            TEXT,
  score_formula          JSONB NOT NULL,
  constants              JSONB NOT NULL,
  tiebreakers            JSONB NOT NULL,
  match_format_defaults  JSONB,
  double_penalty_formula TEXT,
  published_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  published_by_user_id   UUID,
  is_frozen              BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE (custom_ruleset_id, version)
);

CREATE INDEX IF NOT EXISTS idx_custom_ruleset_versions_ruleset
  ON custom_ruleset_versions (custom_ruleset_id, published_at DESC);

-- Quick lookup for the resolver (code → join through parent) and freeze ops.
CREATE INDEX IF NOT EXISTS idx_custom_ruleset_versions_version
  ON custom_ruleset_versions (custom_ruleset_id, version);
