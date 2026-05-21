-- 0040_tournaments_color.sql
-- Adds an optional identity color (ColorToken string) to tournaments.
-- Rendered as a small bubble next to the tournament name in the admin UI.
-- Additive migration: existing rows get NULL, no backfill required.
ALTER TABLE tournaments
  ADD COLUMN color text;
