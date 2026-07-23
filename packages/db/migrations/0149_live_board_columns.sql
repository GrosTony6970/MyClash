-- 0149_live_board_columns.sql
-- Live control room: per-tablet sync health + scorer attention on staff accounts.
-- Health is POPULATED by the scoring-app heartbeat (remediation Phase 5); the
-- attention flag is SET by the scoring pad (Phase 7). This migration only adds
-- the columns the Live board READS. NULL health = UNKNOWN, never "healthy".
-- `IF NOT EXISTS` on last_seen_at keeps this mergeable with Phase 5's migration.

ALTER TABLE event_staff_accounts
  ADD COLUMN IF NOT EXISTS last_seen_at               TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS outbox_depth               INTEGER,
  ADD COLUMN IF NOT EXISTS oldest_pending_age_seconds INTEGER,
  ADD COLUMN IF NOT EXISTS rejected_count             INTEGER,
  ADD COLUMN IF NOT EXISTS needs_attention            BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS needs_attention_reason     TEXT
    CHECK (needs_attention_reason IS NULL OR needs_attention_reason IN ('medic','head_ref','dispute'));
