-- 0038_custom_rulesets.sql
-- Curated ruleset registry: super-admins can author custom rulesets via the UI.
-- A row's (code, version) maps to a Ruleset plugin instance at runtime:
--  - is_system rows mirror the in-code plugins (TF_v1, TF_v1_no_afterblow,
--    Generic_PointsCap) for display purposes; runtime always resolves these
--    through the code registry.
--  - Non-system rows store a JSON AST + constants + tie-breakers that the
--    FormulaRuleset factory uses at runtime to build a Ruleset plugin.

CREATE TABLE IF NOT EXISTS custom_rulesets (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code                TEXT NOT NULL UNIQUE,
  version             TEXT NOT NULL DEFAULT '1.0.0',
  name                TEXT NOT NULL,
  description         TEXT,
  status              TEXT NOT NULL DEFAULT 'draft'
                        CHECK (status IN ('draft', 'published', 'archived')),
  score_formula       JSONB NOT NULL DEFAULT '{}'::jsonb,
  constants           JSONB NOT NULL DEFAULT '{}'::jsonb,
  tiebreakers         JSONB NOT NULL DEFAULT '[]'::jsonb,
  is_default          BOOLEAN NOT NULL DEFAULT FALSE,
  is_system           BOOLEAN NOT NULL DEFAULT FALSE,
  created_by_user_id  UUID,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS custom_rulesets_status_idx ON custom_rulesets (status);
CREATE UNIQUE INDEX IF NOT EXISTS custom_rulesets_default_idx
  ON custom_rulesets (is_default) WHERE is_default = TRUE;

ALTER TABLE custom_rulesets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "custom_rulesets_super_admin_all" ON custom_rulesets;
CREATE POLICY "custom_rulesets_super_admin_all" ON custom_rulesets
  FOR ALL USING (is_super_admin()) WITH CHECK (is_super_admin());

-- Seed the three code-plugin rulesets as display-only system rows.
-- Their formula/constants/tiebreakers fields are nominal — the runtime always
-- prefers the in-code plugin for these codes.
INSERT INTO custom_rulesets
  (code, version, name, description, status, score_formula, constants, tiebreakers, is_default, is_system)
VALUES
  -- Name is the code ("TF_v1"); the human blurb lives in the description
  -- (TF = Tournois Fédéraux FFAMHE, not the old mis-expansion "Tournoi de
  -- Frappe"). Seeded correctly here, so the 0050 rename and the 0070
  -- description-clear are now no-ops on a fresh apply.
  ('TF_v1', '1.0.0', 'TF_v1',
    '(Tournois Fédéraux FFAMHE 2025-2026-2027)',
    'published', '{}'::jsonb, '{}'::jsonb, '[]'::jsonb, TRUE, TRUE),
  ('TF_v1_no_afterblow', '1.0.0', 'TF v1 (no afterblow)',
    'TF v1 variant without afterblow scoring.',
    'published', '{}'::jsonb, '{}'::jsonb, '[]'::jsonb, FALSE, TRUE),
  ('Generic_PointsCap', '1.0.0', 'Generic points cap',
    'Simple highest-score-wins until the points cap is reached.',
    'published', '{}'::jsonb, '{}'::jsonb, '[]'::jsonb, FALSE, TRUE)
ON CONFLICT (code) DO NOTHING;
