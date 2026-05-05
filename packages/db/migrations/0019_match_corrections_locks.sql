ALTER TABLE matches
  ADD COLUMN IF NOT EXISTS side_order TEXT NOT NULL DEFAULT 'red_left',
  ADD COLUMN IF NOT EXISTS locked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS locked_by_user_id UUID,
  ADD COLUMN IF NOT EXISTS locked_by_staff_account_id UUID,
  ADD COLUMN IF NOT EXISTS lock_source TEXT,
  ADD COLUMN IF NOT EXISTS lock_reason TEXT;

ALTER TABLE matches
  DROP CONSTRAINT IF EXISTS matches_side_order_check,
  ADD CONSTRAINT matches_side_order_check CHECK (side_order IN ('red_left', 'blue_left'));

ALTER TABLE matches
  DROP CONSTRAINT IF EXISTS matches_lock_source_check,
  ADD CONSTRAINT matches_lock_source_check CHECK (lock_source IN ('manual', 'auto') OR lock_source IS NULL);

CREATE INDEX IF NOT EXISTS matches_locked_idx
  ON matches(locked_at)
  WHERE locked_at IS NOT NULL;

ALTER TABLE exchanges
  ADD COLUMN IF NOT EXISTS corrected_exchange_id UUID REFERENCES exchanges(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS correction_reason TEXT;

CREATE INDEX IF NOT EXISTS exchanges_corrected_exchange_idx
  ON exchanges(corrected_exchange_id)
  WHERE corrected_exchange_id IS NOT NULL;

ALTER TABLE match_events
  ADD COLUMN IF NOT EXISTS adjustment_ms INTEGER;

ALTER TABLE tournaments
  ADD COLUMN IF NOT EXISTS lock_config_json JSONB NOT NULL DEFAULT
    '{"autoLockEnabled":true,"autoLockDelayMinutes":15,"autoLockCompletedPools":true,"autoLockCompletedBrackets":true}'::jsonb;
