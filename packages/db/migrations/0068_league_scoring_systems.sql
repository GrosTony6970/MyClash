-- 0068_league_scoring_systems.sql
--
-- Reusable named registry of league scoring systems. Today the
-- "scoring system" is hard-coded as 'ffamhe_tf_2026' | 'custom' in
-- `league-scoring.service.ts`; every league that wants something else
-- has to re-author the rank→points table inline. This migration adds
-- a registry table so super-admins can save named presets that any
-- league can pick from a dropdown.
--
-- Existing leagues are untouched. `leagues.scoring_system` keeps
-- storing the code; rows referencing the registry resolve points at
-- read time, rows that say 'custom' continue to use the inline
-- `leagues.scoring_config.customPointsByRank` for back-compat.

BEGIN;

CREATE TABLE IF NOT EXISTS league_scoring_systems (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code            text NOT NULL UNIQUE,
  name            text NOT NULL,
  is_builtin      boolean NOT NULL DEFAULT false,
  is_archived     boolean NOT NULL DEFAULT false,
  points_by_rank  jsonb NOT NULL,
  tie_breakers    jsonb NOT NULL DEFAULT '["total_points","participation_count","medal_count","double_hit_average"]'::jsonb,
  description     text,
  created_by_user_id uuid REFERENCES auth.users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS league_scoring_systems_active_idx
  ON league_scoring_systems (code)
  WHERE is_archived = false;

-- Seed the built-in FFAMHE TF 2026 row. Idempotent via ON CONFLICT.
INSERT INTO league_scoring_systems (code, name, is_builtin, points_by_rank, tie_breakers, description)
VALUES (
  'ffamhe_tf_2026',
  'FFAMHE TF 2026',
  true,
  '{"1":16,"2":13,"3":11,"4":10,"5":9,"6":8,"7":7,"8":6,"9":5,"10":4,"11":3,"12":2,"13":1,"14":1,"15":1,"16":1}'::jsonb,
  '["total_points","participation_count","medal_count","double_hit_average"]'::jsonb,
  'Official FFAMHE Trophée Fédéral 2025-2026 ranking.'
)
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  is_builtin = EXCLUDED.is_builtin,
  points_by_rank = EXCLUDED.points_by_rank,
  tie_breakers = EXCLUDED.tie_breakers,
  description = EXCLUDED.description,
  updated_at = now();

COMMIT;
