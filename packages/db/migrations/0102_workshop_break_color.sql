-- 0102_workshop_break_color.sql
--
-- Optional identity colour for workshop break bars on the workshop
-- schedule board. Stored as a hex string (e.g. "#f59e0b"); null falls back
-- to the board's default neutral break styling. Mirrors programme blocks'
-- `color_hex` (migration 0028) but kept on the workshop-only store (0101).

ALTER TABLE workshop_breaks ADD COLUMN IF NOT EXISTS color TEXT;

NOTIFY pgrst, 'reload schema';
