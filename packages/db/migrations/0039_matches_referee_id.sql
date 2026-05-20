-- 0039_matches_referee_id.sql
-- Add referee_id to matches so operators can assign a referee per match.
-- Nullable; references persons(id) and clears to NULL if the person is deleted.

ALTER TABLE matches
  ADD COLUMN IF NOT EXISTS referee_id UUID
    REFERENCES persons(id) ON DELETE SET NULL;
