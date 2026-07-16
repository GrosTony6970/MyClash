-- 0140_workshop_break_color.sql
--
-- Optional identity colour for workshop break bars on the workshop
-- schedule board. Stored as a hex string (e.g. "#f59e0b"); null falls back
-- to the board's default neutral break styling. Mirrors programme blocks'
-- `color_hex` (migration 0028) but kept on the workshop-only store (0101).
--
-- Renumbered from 0102 → 0140: this shipped as a second `0102_` two days
-- after 0102_events_timezone.sql had already taken that prefix, which left
-- the load order to a lexicographic tiebreak and kept `pnpm db:review` red.
-- The re-apply under the new filename is a no-op — the ALTER below is
-- IF NOT EXISTS with no DEFAULT, so it cannot rewrite existing rows.

ALTER TABLE workshop_breaks ADD COLUMN IF NOT EXISTS color TEXT;

-- Drop the ledger row for the old filename so it doesn't linger as a
-- migration that no longer exists on disk. Guarded because the fresh-replay
-- path (scripts/replay-db-migrations.mjs) has no ledger table at all.
DO $$
BEGIN
  IF to_regclass('public.myclash_schema_migrations') IS NOT NULL THEN
    DELETE FROM public.myclash_schema_migrations
    WHERE filename = '0102_workshop_break_color.sql';
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
