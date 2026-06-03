-- 0089_league_scoring_systems_default.sql
--
-- Add an `is_default` flag to the league scoring system catalogue so the
-- league wizard can pre-select one ruleset for newly-created leagues.
-- Mirrors the long-standing `is_default` on penalty/scoring rulesets.
--
-- Enforcement: a partial unique index over `((1)) WHERE is_default = true`
-- means at most ONE row may carry the flag at any time. Setting a new
-- default from the service layer auto-clears the previous one in the
-- same write (see league-scoring-systems.service.ts setDefault).

ALTER TABLE league_scoring_systems
  ADD COLUMN IF NOT EXISTS is_default boolean NOT NULL DEFAULT false;

CREATE UNIQUE INDEX IF NOT EXISTS league_scoring_systems_one_default_idx
  ON league_scoring_systems ((1)) WHERE is_default = true;

NOTIFY pgrst, 'reload schema';
