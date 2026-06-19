-- 0105_workshops_color.sql
-- Adds an optional identity color (ColorToken string, e.g. 'red' / 'amber') to
-- workshops, mirroring tournaments.color (0040). Rendered as a left color band
-- in the admin list and on the public workshop cards / detail header.
-- Additive: existing rows get NULL, no backfill required.
ALTER TABLE workshops
  ADD COLUMN color text;
