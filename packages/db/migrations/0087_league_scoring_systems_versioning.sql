-- 0087_league_scoring_systems_versioning.sql
--
-- Adds full versioning to league_scoring_systems + pins leagues to a
-- specific version of their scoring system.
--
-- Before this migration: leagues.scoring_system stored just a code
-- (e.g. 'ffamhe_tf_2026'). Editing a scoring system retroactively
-- changed every league's points.
--
-- After this migration: leagues.scoring_system stores 'code@version'
-- (e.g. 'ffamhe_tf_2026@1.0.0'). Editing a system snapshots the prior
-- values to league_scoring_system_versions and bumps the version;
-- existing leagues keep their pinned version's points until they
-- explicitly opt in to a newer version via the leagues-edit picker.

-- 1. Add version column to league_scoring_systems
ALTER TABLE league_scoring_systems
  ADD COLUMN IF NOT EXISTS version TEXT NOT NULL DEFAULT '1.0.0';

-- 2. Snapshot table for prior versions
CREATE TABLE IF NOT EXISTS league_scoring_system_versions (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  league_scoring_system_id    UUID NOT NULL REFERENCES league_scoring_systems(id) ON DELETE CASCADE,
  version                     TEXT NOT NULL,
  name                        TEXT NOT NULL,
  points_by_rank              JSONB NOT NULL,
  tie_breakers                JSONB NOT NULL,
  description                 TEXT,
  published_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  published_by_user_id        UUID,
  UNIQUE (league_scoring_system_id, version)
);

CREATE INDEX IF NOT EXISTS league_scoring_system_versions_system_idx
  ON league_scoring_system_versions(league_scoring_system_id);

-- 3. Seed the initial version row for every existing system
INSERT INTO league_scoring_system_versions
  (league_scoring_system_id, version, name, points_by_rank, tie_breakers, description, published_at, published_by_user_id)
SELECT
  id,
  COALESCE(version, '1.0.0'),
  name,
  points_by_rank,
  tie_breakers,
  description,
  created_at,
  created_by_user_id
FROM league_scoring_systems
ON CONFLICT (league_scoring_system_id, version) DO NOTHING;

-- 4. Backfill leagues.scoring_system to encode @version.
--    Existing leagues currently store just the code; append @1.0.0
--    when no @ is present. Resolver-side fallback also accepts
--    code-only values, but this keeps the data clean.
UPDATE leagues
SET scoring_system = scoring_system || '@1.0.0'
WHERE scoring_system IS NOT NULL
  AND scoring_system <> ''
  AND POSITION('@' IN scoring_system) = 0;

NOTIFY pgrst, 'reload schema';
