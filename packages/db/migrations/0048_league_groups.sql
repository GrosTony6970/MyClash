-- Migration 0048: league-defined groups.
--
-- Leagues now own a list of "groups" (the operator's choice — e.g.
-- "Sabre Mixed", "Longsword Open"). When a tournament is attached to
-- a league, the link row carries group_id pointing at one of those.
--
-- The scoring layer continues to use league_rankings.ranking_group_key
-- (a TEXT key) — migration 0049 will switch the scorer to derive that
-- key from the group name. For now both code paths coexist.

CREATE TABLE IF NOT EXISTS league_groups (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id   UUID NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  sort_order  INT  NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (league_id, name)
);

CREATE INDEX IF NOT EXISTS league_groups_league_idx
  ON league_groups (league_id);

ALTER TABLE league_tournament_links
  ADD COLUMN IF NOT EXISTS group_id UUID REFERENCES league_groups(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS league_tournament_links_group_idx
  ON league_tournament_links (group_id)
  WHERE group_id IS NOT NULL;
