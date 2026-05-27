-- 0071_penalty_ref_alphanumeric.sql
--
-- Allow alphanumeric penalty REF identifiers like "R7a" or "B-12" by
-- widening the column type from INTEGER to TEXT. Real rulebooks use
-- mixed-case codes for sub-rules and the engine has always treated
-- refNumber as an opaque identifier, never as an arithmetic counter —
-- the integer constraint was the only thing keeping it numeric.
--
-- Existing rows cast cleanly via `USING ref_number::text`, so historical
-- integer values like 1, 2, 3 stay readable as "1", "2", "3" and remain
-- comparable in the unique constraint.
--
-- Two tables touch this column: the per-ruleset entries (template) and
-- the per-match snapshot rows that record actual sanctions handed out.

BEGIN;

-- IMPORTANT — order matters. The `penalty_entries_ref_check` CHECK
-- constraint references `ref_number > 0`. When we ALTER the column
-- type to TEXT, Postgres re-validates every still-attached CHECK
-- against the new column type — and `text > integer` has no operator,
-- so the ALTER fails with:
--   ERROR 42883: operator does not exist: text > integer
-- The fix is to DROP the constraint first, THEN change the column type.

-- Per-ruleset template entries.
ALTER TABLE penalty_ruleset_entries
  DROP CONSTRAINT IF EXISTS penalty_entries_ref_check;

ALTER TABLE penalty_ruleset_entries
  ALTER COLUMN ref_number TYPE TEXT USING ref_number::text;

-- Per-match snapshot rows on match_penalties carry the same REF identifier
-- when a penalty was issued via a ruleset entry (nullable for direct
-- card overrides). No CHECK constraint on this column (see 0016), so
-- the ALTER works in isolation.
ALTER TABLE match_penalties
  ALTER COLUMN ref_number TYPE TEXT USING ref_number::text;

-- The existing UNIQUE(ruleset_id, ref_number) and btree indices survive
-- the column type change automatically — Postgres rebuilds them.

COMMIT;
