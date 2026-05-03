-- 0012_fighter_merge.sql
-- T-1302: reversible fighter merge metadata.

ALTER TABLE fighters
  ADD COLUMN IF NOT EXISTS merged_into_fighter_id UUID REFERENCES fighters(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS merged_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS merge_reverted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS fighters_merged_into_idx
  ON fighters (merged_into_fighter_id);

CREATE INDEX IF NOT EXISTS fighters_deleted_at_idx
  ON fighters (deleted_at);
