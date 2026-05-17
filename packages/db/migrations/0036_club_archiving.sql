ALTER TABLE clubs
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS clubs_archived_at_idx
  ON clubs (archived_at);
