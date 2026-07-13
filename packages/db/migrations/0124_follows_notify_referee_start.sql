-- 0124: ensure follows.notify_referee_start exists (idempotent backfill).
--
-- The column is already defined on fresh databases (0001_init.sql), but any
-- production database that ran 0001_init before 2026-04-29 predates it. This
-- ADD COLUMN IF NOT EXISTS is a safe no-op where it already exists and backfills
-- older databases, wiring the "notify when a followed person starts refereeing"
-- follow toggle.
ALTER TABLE follows ADD COLUMN IF NOT EXISTS notify_referee_start BOOLEAN NOT NULL DEFAULT FALSE;

NOTIFY pgrst, 'reload schema';
